'use strict';

const cron = require('node-cron');
const { CronExpressionParser } = require('cron-parser');
const { db } = require('./db');

/**
 * Manages cron-based job scheduling.
 * Jobs with a `cron_expression` are kept in `scheduled` status between runs.
 * When a scheduled time fires, the job is pushed onto the worker queue.
 * After each run completes (or fails) the job is automatically reset to
 * `scheduled` so it can run again on the next cron tick.
 */
class Scheduler {
  constructor() {
    /** @type {Map<number, import('node-cron').ScheduledTask>} */
    this._tasks = new Map();
    /** @type {import('./queue')|null} */
    this._queue = null;
  }

  /**
   * Seed the scheduler from the database and wire it to the job queue.
   * Call once at application startup.
   * @param {import('./queue')} queue
   */
  init(queue) {
    this._queue = queue;
    const jobs = db
      .prepare("SELECT id, cron_expression FROM jobs WHERE cron_expression IS NOT NULL AND status = 'scheduled'")
      .all();
    for (const job of jobs) {
      this._scheduleTask(job.id, job.cron_expression);
    }
    if (jobs.length > 0) {
      console.log(`[scheduler] Loaded ${jobs.length} cron job(s) from database`);
    }
  }

  /**
   * Register a new cron task for a job.
   * Safe to call multiple times – replaces any existing task for the same id.
   * @param {number} jobId
   * @param {string} expression  Standard 5-field cron expression
   */
  register(jobId, expression) {
    this._scheduleTask(jobId, expression);
  }

  /**
   * Stop and remove the cron task for a job.
   * @param {number} jobId
   */
  unregister(jobId) {
    const task = this._tasks.get(jobId);
    if (task) {
      task.stop();
      this._tasks.delete(jobId);
    }
  }

  /**
   * Reset a completed/failed cron job back to `scheduled` status and update
   * its `next_run_at` timestamp.  The existing in-memory cron task continues
   * running; the status flip is all that is required.
   * @param {number} jobId
   * @param {string} expression
   */
  reschedule(jobId, expression) {
    const nextRun = computeNextRun(expression);
    db.prepare("UPDATE jobs SET status='scheduled', next_run_at=?, completed_at=NULL WHERE id=?")
      .run(nextRun, jobId);
    // Re-register the task if it was previously removed (e.g. app restart path).
    if (!this._tasks.has(jobId)) {
      this._scheduleTask(jobId, expression);
    }
  }

  /**
   * Stop all active cron tasks and clear the task map.
   * Useful for graceful shutdown or test cleanup.
   */
  destroy() {
    for (const [, task] of this._tasks) {
      task.stop();
    }
    this._tasks.clear();
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _scheduleTask(jobId, expression) {
    const existing = this._tasks.get(jobId);
    if (existing) existing.stop();

    const task = cron.schedule(expression, () => {
      const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId);
      if (!job) {
        // Job was deleted; clean up the task.
        this.unregister(jobId);
        return;
      }
      if (job.status !== 'scheduled') return; // already queued / running

      db.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(jobId);
      this._queue.pushLow(jobId);
    });

    this._tasks.set(jobId, task);
  }
}

/**
 * Compute the next occurrence of a cron expression as an ISO 8601 string.
 * The caller is responsible for ensuring `expression` is valid (see
 * `validateCronExpression`).  An invalid expression will cause
 * `CronExpressionParser.parse()` to throw.
 * @param {string} expression
 * @returns {string}
 */
function computeNextRun(expression) {
  const interval = CronExpressionParser.parse(expression);
  return interval.next().toDate().toISOString();
}

/**
 * Validate a cron expression.
 * @param {string} expression
 * @returns {boolean}
 */
function validateCronExpression(expression) {
  return cron.validate(expression);
}

const scheduler = new Scheduler();

module.exports = { scheduler, computeNextRun, validateCronExpression };
