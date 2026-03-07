'use strict';

const { EventEmitter } = require('events');

/**
 * Simple single-worker FIFO queue.
 * Jobs are processed one at a time.
 */
class Queue extends EventEmitter {
  constructor(worker) {
    super();
    if (typeof worker !== 'function') {
      throw new TypeError('worker must be a function');
    }
    this._worker = worker;
    this._pending = [];
    this._running = false;
  }

  /** Add a job id to the queue. */
  push(jobId) {
    this._pending.push(jobId);
    this._drain();
  }

  _drain() {
    if (this._running || this._pending.length === 0) return;
    const jobId = this._pending.shift();
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
