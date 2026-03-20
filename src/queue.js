'use strict';

const { EventEmitter } = require('events');

/**
 * Single-worker job queue with two priority lanes.
 *
 * • **push(jobId)**    – high priority (manually queued jobs).
 * • **pushLow(jobId)** – low priority  (cron-triggered jobs).
 *
 * When the worker finishes, the next job is taken from the high-priority
 * lane first; only when it is empty is a low-priority job started.
 * Jobs within the same lane are processed in FIFO order.
 */
class Queue extends EventEmitter {
  constructor(worker) {
    super();
    if (typeof worker !== 'function') {
      throw new TypeError('worker must be a function');
    }
    this._worker = worker;
    this._pending = [];
    this._pendingLow = [];
    this._running = false;
  }

  /** Add a high-priority (manual) job id to the queue. */
  push(jobId) {
    this._pending.push(jobId);
    this._drain();
  }

  /** Add a low-priority (cron-triggered) job id to the queue. */
  pushLow(jobId) {
    this._pendingLow.push(jobId);
    this._drain();
  }

  /** Remove a job from both priority lanes (if it hasn't started yet). */
  remove(jobId) {
    this._pending = this._pending.filter(id => id !== jobId);
    this._pendingLow = this._pendingLow.filter(id => id !== jobId);
  }

  _drain() {
    if (this._running || (this._pending.length === 0 && this._pendingLow.length === 0)) return;
    const jobId = this._pending.length > 0
      ? this._pending.shift()
      : this._pendingLow.shift();
    this._running = true;
    Promise.resolve()
      .then(() => this._worker(jobId))
      .catch((err) => this.emit('error', err, jobId))
      .finally(() => {
        this._running = false;
        setImmediate(() => this._drain());
      });
  }
}

module.exports = Queue;
