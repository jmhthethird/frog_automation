'use strict';

/**
 * In-memory singleton lock for automation runs.
 *
 * Only one automation may execute at a time. The lock tracks which automation
 * is running, which domains it is processing, progress text, and a cancellation
 * flag.  The lock resets on process restart — this is intentional because a
 * running automation cannot survive a restart anyway.
 */

const lock = {
  isRunning:    false,
  automationId: null,
  domains:      [],
  startedAt:    null,
  progress:     '',
  cancelled:    false,
  results:      null,
  error:        null,
};

/**
 * Attempt to acquire the lock for an automation run.
 *
 * @param {string} automationId
 * @param {string[]} domains
 * @returns {boolean} true if acquired, false if already held
 */
function acquireLock(automationId, domains) {
  if (lock.isRunning) return false;
  lock.isRunning    = true;
  lock.automationId = automationId;
  lock.domains      = domains;
  lock.startedAt    = new Date().toISOString();
  lock.progress     = 'Starting…';
  lock.cancelled    = false;
  lock.results      = null;
  lock.error        = null;
  return true;
}

/**
 * Release the lock after a run completes (success or failure).
 *
 * @param {object} [results]  Optional results payload.
 * @param {string} [error]    Optional error message.
 */
function releaseLock(results, error) {
  lock.isRunning    = false;
  lock.cancelled    = false;
  lock.progress     = error ? `Error: ${error}` : 'Complete';
  lock.results      = results || null;
  lock.error        = error || null;
}

/**
 * Signal cancellation to the running automation.  The automation must
 * check `lock.cancelled` periodically and exit early when it is set.
 */
function cancelLock() {
  if (lock.isRunning) {
    lock.cancelled = true;
    lock.progress  = 'Cancelling…';
  }
}

/**
 * Update the progress message on the lock.
 *
 * @param {string} msg
 */
function setProgress(msg) {
  lock.progress = msg;
}

/**
 * Return a shallow copy of the current lock state (safe to serialise).
 */
function getLockState() {
  return { ...lock };
}

module.exports = { acquireLock, releaseLock, cancelLock, setProgress, getLockState };
