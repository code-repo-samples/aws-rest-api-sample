/**
 * ============================================================
 * ERROR LOGGING PROCESSOR
 * (Local / GitHub → reports/, Fargate → /tmp + S3)
 * ============================================================
 *
 * Design goals:
 *  - Append-only logging (safe under parallel load)
 *  - Deterministic file locations
 *  - Artillery run–aware S3 uploads
 *  - Zero coupling to Artillery internals
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
 */
const isFargate = Boolean(process.env.AWS_EXECUTION_ENV);

/**
 * S3 bucket used only when running in Fargate.
 */
const S3_BUCKET =
  process.env.METRICS_BUCKET || 'artilleryio-test-data-983610474809';

/**
 * Artillery run ID exposed during `run-fargate`.
 */
const ARTILLERY_RUN_ID = isFargate
  ? process.env.ARTILLERY_TEST_RUN_ID
  : null;

/**
 * S3 prefix that matches Artillery’s own artifact layout.
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
 * Project root (used only outside Fargate).
 */
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Error log directory:
 *  - Fargate → /tmp/artillery_results
 *  - Local / CI → ./reports
 */
const RESULTS_DIR = isFargate
  ? '/tmp/artillery_results'
  : path.join(PROJECT_ROOT, 'reports');

/**
 * Ensure results directory exists.
 */
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

/**
 * Error log file path.
 */
const ERROR_LOG_FILE = path.join(RESULTS_DIR, 'error.log');

/**
 * ------------------------------------------------------------
 * DIAGNOSTICS
 * ------------------------------------------------------------
 */

// console.log('🧭 Error Logger Environment:', isFargate ? 'FARGATE' : 'LOCAL / CI');
// console.log('📁 Error log directory:', RESULTS_DIR);
// console.log('📝 Error log file:', ERROR_LOG_FILE);

if (isFargate) {
  console.log('🧪 ARTILLERY_TEST_RUN_ID:', ARTILLERY_RUN_ID);
  console.log('📦 S3 Upload Prefix:', S3_RUN_PREFIX);
}

/**
 * ------------------------------------------------------------
 * S3 CLIENT (Fargate only)
 * ------------------------------------------------------------
 */
const s3 = isFargate ? new AWS.S3({ region: 'us-east-1' }) : null;

/**
 * ------------------------------------------------------------
 * S3 UPLOAD HELPER
 * ------------------------------------------------------------
 */

/**
 * Uploads the error log to S3 under the Artillery run folder.
 * This is called after each append to guarantee durability.
 *
 * @param {string} localPath - Absolute path to the error log file.
 */
async function flushErrorLogToS3(localPath) {
  if (!isFargate || !s3 || !S3_RUN_PREFIX) return;

  try {
    const data = fs.readFileSync(localPath);
    const s3Key = `${S3_RUN_PREFIX}/error.log`;

    await s3
      .putObject({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: data
      })
      .promise();

    console.log(`✅ Error log flushed to s3://${S3_BUCKET}/${s3Key}`);
  } catch (err) {
    console.error('❌ Failed to flush error log to S3:', err);
  }
}

/**
 * ------------------------------------------------------------
 * ARTILLERY ERROR HOOK
 * ------------------------------------------------------------
 */

/**
 * Logs HTTP errors in an append-only format.
 *
 * @param {Object} request - Artillery request object
 * @param {Object} response - Artillery response object
 * @param {Object} context - Artillery context
 * @param {Object} ee - Artillery event emitter
 * @param {Function} next - Continuation callback
 */
function logError(request, response, context, ee, next) {
  console.log(`🌐 Request URL: ${request.url}`);

  if (response.statusCode >= 200) {
    const logLine =
      [
        new Date().toISOString(),
        request.method,
        request.url,
        response.statusCode,
        typeof response.body === 'object'
          ? JSON.stringify(response.body)
          : response.body
      ].join(' | ') + '\n';

    /**
     * Append-only write is safe for parallel workers.
     */
    fs.appendFileSync(ERROR_LOG_FILE, logLine, 'utf8');

    /**
     * Immediately flush to S3 when running in Fargate.
     */
    flushErrorLogToS3(ERROR_LOG_FILE).catch(() => {});
  }

  return next();
}

/**
 * ------------------------------------------------------------
 * DATA GENERATORS (UNCHANGED)
 * ------------------------------------------------------------
 */

/**
 * Generates random query parameters for GET requests.
 */
function randomGet(userContext, events, done) {
  const names = ['Alice', 'Bob', 'Charlie', 'Diana'];
  const addresses = ['NYC', 'LA', 'Chicago', 'Boston'];

  userContext.vars.name =
    names[Math.floor(Math.random() * names.length)];
  userContext.vars.address =
    addresses[Math.floor(Math.random() * addresses.length)];

  return done();
}

/**
 * Generates random request bodies for POST requests.
 */
function randomPost(userContext, events, done) {
  const names = ['Alice', 'Bob', 'Charlie', 'Diana'];
  const addresses = ['NYC', 'LA', 'Chicago', 'Boston'];

  userContext.vars.postData = {
    name: names[Math.floor(Math.random() * names.length)],
    address: addresses[Math.floor(Math.random() * addresses.length)]
  };

  return done();
}

/**
 * ------------------------------------------------------------
 * MODULE EXPORTS
 * ------------------------------------------------------------
 */
module.exports = {
  randomGet,
  randomPost,
  logError
};
