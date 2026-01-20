/**
 * ============================================================
 * POOL PROCESSOR
 * ============================================================
 * Reads test data from CSV files using a persistent pointer.
 *
 * Guarantees:
 *  - No duplicate usage within a run
 *  - Pointer persistence across runs (local/CI only)
 *  - Safe concurrent access across VUs
 *  - Graceful stop when data runs out
 *
 * Environment behavior:
 *  - Local / GitHub:
 *      CSV → project root
 *      Pointer → project root
 *
 *  - Fargate:
 *      CSV → project bundle (read-only)
 *      Pointer → /tmp/artillery_results
 */

const fs = require('fs');
const path = require('path');

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
 * Resolve the Artillery project root (one level above processors).
 */
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Writable directory for pointer files.
 * Required because Fargate containers have read-only project dirs.
 */
const POINTER_DIR = isFargate
  ? '/tmp/artillery_results'
  : PROJECT_ROOT;

/**
 * Ensure pointer directory exists (Fargate only).
 */
if (!fs.existsSync(POINTER_DIR)) {
  fs.mkdirSync(POINTER_DIR, { recursive: true });
}

/**
 * ------------------------------------------------------------
 * IN-MEMORY STATE
 * ------------------------------------------------------------
 */

/**
 * CSV pools loaded once per worker process.
 * Keyed by filename.
 */
const pools = {};

/**
 * Indicates whether the data pool is fully consumed.
 * Once drained, all VUs skip further work.
 */
let isDrained = false;

/**
 * Tracks pointer reset per file to ensure reset
 * happens only once per run (not per VU).
 */
const pointerResetDone = {};

/**
 * ------------------------------------------------------------
 * CORE POOL LOGIC
 * ------------------------------------------------------------
 */

/**
 * Pulls the next row from a CSV file and maps it to variables.
 *
 * Supported YAML variables:
 *   sourceFile   - CSV filename (relative to project root)
 *   targetVar    - Single variable name (default: productId)
 *   columnMap    - Array of variable names for multi-column CSV
 *   resetPointer - Boolean: reset pointer at start of run
 */
function pullFromPool(userContext, events, done) {
  /**
   * If the pool is already drained, skip this VU entirely.
   */
  if (isDrained) {
    userContext.vars.skipMe = true;
    return done();
  }

  const fileName = userContext.vars.sourceFile || 'created_products.csv';
  const targetVar = userContext.vars.targetVar || 'productId';
  const columnMap = userContext.vars.columnMap;
  const resetPointer = userContext.vars.resetPointer === true;

  /**
   * ----------------------------------------------------------
   * LOAD CSV INTO MEMORY (ONCE PER WORKER)
   * ----------------------------------------------------------
   */
  if (!pools[fileName]) {
    const csvPath = path.resolve(PROJECT_ROOT, fileName);

    console.log('📄 Loading CSV:', csvPath);

    if (!fs.existsSync(csvPath)) {
      return done(new Error(`CSV not found at path: ${csvPath}`));
    }

    pools[fileName] = fs
      .readFileSync(csvPath, 'utf8')
      .replace(/^\uFEFF/, '') // Strip BOM if present
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  }

  /**
   * ----------------------------------------------------------
   * POINTER FILE RESOLUTION
   * ----------------------------------------------------------
   * Pointer is stored in:
   *  - /tmp/artillery_results (Fargate)
   *  - project root (local / CI)
   */
  const pointerFile = path.resolve(
    POINTER_DIR,
    `.${path.basename(fileName)}.pointer`
  );

  try {
    /**
     * --------------------------------------------------------
     * RESET POINTER (ONCE PER RUN, IF REQUESTED)
     * --------------------------------------------------------
     */
    if (resetPointer && !pointerResetDone[fileName]) {
      fs.writeFileSync(pointerFile, '0');
      pointerResetDone[fileName] = true;
      console.log('🔄 Pointer reset:', pointerFile);
    }

    /**
     * Ensure pointer file exists.
     */
    if (!fs.existsSync(pointerFile)) {
      fs.writeFileSync(pointerFile, '0');
    }

    /**
     * Read current pointer value.
     */
    const index =
      parseInt(fs.readFileSync(pointerFile, 'utf8'), 10) || 0;

    /**
     * --------------------------------------------------------
     * END-OF-DATA HANDLING
     * --------------------------------------------------------
     */
    if (index >= pools[fileName].length) {
      console.log('⏹️ DATA POOL DRAINED');

      isDrained = true;
      userContext.vars.skipMe = true;

      /// Gracefully stop the test shortly
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50);
      return done();
    }

    /**
     * --------------------------------------------------------
     * MAP CSV ROW TO CONTEXT VARIABLES
     * --------------------------------------------------------
     */
    const row = pools[fileName][index].split(',');

    if (Array.isArray(columnMap)) {
      columnMap.forEach((varName, i) => {
        userContext.vars[varName] = row[i]?.trim();
      });
    } else {
      userContext.vars[targetVar] = row[0]?.trim();
    }

    /**
     * Advance pointer for the next VU.
     */
    fs.writeFileSync(pointerFile, String(index + 1));

    userContext.vars.skipMe = false;
  } catch (err) {
    return done(err);
  }

  return done();
}

/**
 * ------------------------------------------------------------
 * MODULE EXPORTS
 * ------------------------------------------------------------
 */
module.exports = { pullFromPool };
