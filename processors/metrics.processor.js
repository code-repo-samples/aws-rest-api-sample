/**
 * ============================================================
 * METRICS & LOGGING PROCESSOR
 * (Local / GitHub → reports/, Fargate → /tmp + S3)
 * ============================================================
 *
 * Behavior:
 *  - Local / CI:
 *      Writes files to ./reports
 *      No S3 interaction
 *
 *  - Fargate (artillery run-fargate):
 *      Writes files to /tmp/artillery_results
 *      Uploads artifacts to:
 *        s3://<bucket>/test-runs/<ARTILLERY_TEST_RUN_ID>/
 *
 * Design goals:
 *  - Deterministic paths
 *  - No reliance on Artillery internal directories
 *  - Safe fallbacks
 *  - CloudWatch-visible diagnostics
 */

const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

/**
 * ------------------------------------------------------------
 * ENVIRONMENT DETECTION
 * ------------------------------------------------------------
 */

/**
 * True when running inside AWS Fargate.
 * AWS_EXECUTION_ENV is always set by ECS/Fargate.
 */
const isFargate = Boolean(process.env.AWS_EXECUTION_ENV);

/**
 * S3 bucket used for metrics uploads (Fargate only).
 */
const S3_BUCKET =
  process.env.METRICS_BUCKET || 'artilleryio-test-data-983610474809';

/**
 * Artillery exposes ARTILLERY_TEST_RUN_ID during run-fargate.
 * This value is required to colocate custom artifacts correctly.
 */
const ARTILLERY_RUN_ID = isFargate
  ? process.env.ARTILLERY_TEST_RUN_ID
  : null;

/**
 * S3 prefix used for uploads.
 * Matches Artillery’s own result structure.
 */
const S3_RUN_PREFIX = ARTILLERY_RUN_ID
  ? `test-runs/${ARTILLERY_RUN_ID}`
  : null;

/**
 * ------------------------------------------------------------
 * FILESYSTEM PATHS
 * ------------------------------------------------------------
 */

/**
 * Local project root (used only when NOT running in Fargate).
 */
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Results directory:
 *  - Fargate → /tmp/artillery_results
 *  - Local / CI → ./reports
 */
const RESULTS_DIR = isFargate
  ? '/tmp/artillery_results'
  : path.join(PROJECT_ROOT, 'reports');

/**
 * Ensure the results directory exists.
 */
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

/**
 * Result file paths.
 */
const METRICS_FILE = path.join(RESULTS_DIR, 'artillery-metrics.jsonl');
const IDS_FILE = path.join(RESULTS_DIR, 'created_products.txt');

/**
 * ------------------------------------------------------------
 * DIAGNOSTIC LOGGING
 * ------------------------------------------------------------
 */

// console.log('🧭 Execution Environment:', isFargate ? 'FARGATE' : 'LOCAL / CI');
// console.log('📁 Results directory:', RESULTS_DIR);
// console.log('📝 Metrics file:', METRICS_FILE);
// console.log('📝 Product IDs file:', IDS_FILE);

if (isFargate) {
  console.log('🧪 ARTILLERY_TEST_RUN_ID:', ARTILLERY_RUN_ID);
  console.log('📦 S3 Upload Prefix:', S3_RUN_PREFIX);
  console.log('🪣 S3 Bucket:', S3_BUCKET);
}

/**
 * ------------------------------------------------------------
 * WRITE STREAMS
 * ------------------------------------------------------------
 */

/**
 * Streams stay open for the lifetime of the process.
 * This avoids filesystem overhead on every write.
 */
const metricsStream = fs.createWriteStream(METRICS_FILE, { flags: 'a' });
const idsStream = fs.createWriteStream(IDS_FILE, { flags: 'a' });

/**
 * ------------------------------------------------------------
 * S3 CLIENT (Fargate only)
 * ------------------------------------------------------------
 */
const s3 = isFargate ? new AWS.S3({ region: 'us-east-1' }) : null;

/**
 * ------------------------------------------------------------
 * S3 UPLOAD HELPERS
 * ------------------------------------------------------------
 */

/**
 * Uploads a local file to S3 under the Artillery run folder.
 *
 * @param {string} localPath - Absolute path to the local file.
 * @param {string} filename - Base filename for the S3 object.
 */
async function flushToS3(localPath, filename) {
  if (!isFargate || !s3 || !S3_RUN_PREFIX) return;

  try {
    /**
     * Read the full file contents.
     * This guarantees durability even if the container exits.
     */
    const data = fs.readFileSync(localPath);

    /**
     * Final S3 key matches Artillery’s artifact layout.
     */
    const s3Key = `${S3_RUN_PREFIX}/${filename}`;

    await s3
      .putObject({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: data
      })
      .promise();

    console.log(`✅ Flushed to s3://${S3_BUCKET}/${s3Key}`);
  } catch (err) {
    console.error('❌ S3 flush failed:', err);
  }
}

/**
 * ------------------------------------------------------------
 * METRIC / ID WRITERS
 * ------------------------------------------------------------
 */

/**
 * Writes a single metric entry and immediately flushes to S3
 * when running in Fargate.
 *
 * @param {Object} metric - Metric payload to persist.
 */
async function writeMetric(metric) {
  metricsStream.write(JSON.stringify(metric) + '\n');
  // console.log('📈 Metric recorded:', metric);

  await flushToS3(METRICS_FILE, 'artillery-metrics.jsonl');
}

/**
 * Writes a product ID and immediately flushes to S3
 * when running in Fargate.
 *
 * @param {string} id - Product identifier to persist.
 */
async function writeProductId(id) {
  idsStream.write(`${id}\n`);
  console.log('📝 Logged productId:', id);

  await flushToS3(IDS_FILE, 'created_products.txt');
}

/**
 * ------------------------------------------------------------
 * ARTILLERY HOOKS
 * ------------------------------------------------------------
 */

/**
 * Called when a virtual user starts.
 */
function scenarioStart(userContext, events, done) {
  const metric = {
    ts: Date.now(),
    type: 'vuser_start',
    scenario: userContext.scenario?.name || 'UNKNOWN'
  };

  writeMetric(metric).finally(done);
}

/**
 * Called when a virtual user ends.
 */
function scenarioEnd(userContext, events, done) {
  const metric = {
    ts: Date.now(),
    type: 'vuser_end',
    scenario: userContext.scenario?.name || 'UNKNOWN'
  };

  writeMetric(metric).finally(done);
}

/**
 * Captures per-request latency and status metrics.
 */
function captureMetrics(requestParams, response, userContext, ee, next) {
  const latency = response?.timings?.phases?.total;

  if (typeof latency === 'number') {
    const metric = {
      ts: Date.now(),
      type: 'request',
      name: requestParams.name || 'UNNAMED',
      method: requestParams.method,
      statusCode: response.statusCode,
      latencyMs: latency
    };

    writeMetric(metric).finally(next);
  } else {
    next();
  }
}

/**
 * Logs product IDs returned by successful create requests.
 */
function logProductId(requestParams, response, userContext, ee, next) {
  if (response.statusCode === 201 && userContext.vars.productId) {
    writeProductId(userContext.vars.productId).finally(next);
  } else {
    next();
  }
}

/**
 * ------------------------------------------------------------
 * ERROR TRACKING / FAIL-FAST LOGIC
 * ------------------------------------------------------------
 */

let globalErrorCount = 0;
const ERROR_THRESHOLD = 50_000;
let shuttingDown = false;

/**
 * Tracks HTTP errors and terminates the process
 * if a hard threshold is reached.
 */
function logResponse(requestParams, response, userContext, ee, next) {
  if (response.statusCode >= 400) {
    globalErrorCount++;
    console.log(`⚠️ Error #${globalErrorCount}: ${response.statusCode}`);

    if (!shuttingDown && globalErrorCount >= ERROR_THRESHOLD) {
      shuttingDown = true;
      console.log('🚨 Error threshold reached — shutting down...');
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50);
    }
  }

  next();
}

/**
 * ------------------------------------------------------------
 * MODULE EXPORTS
 * ------------------------------------------------------------
 */
module.exports = {
  scenarioStart,
  scenarioEnd,
  captureMetrics,
  logProductId,
  logResponse
};
