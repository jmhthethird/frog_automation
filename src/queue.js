'use strict';

const { EventEmitter } = require('events');

/**
 * Concurrent FIFO job queue.
 * Up to `concurrency` jobs run simultaneously; additional jobs wait in order.
 */
class Queue extends EventEmitter {
  /**
   * @param {function} worker              - Async function called with each job id.
   * @param {object}   [opts]
   * @param {number}   [opts.concurrency=1]  Max simultaneous workers (≥ 1).
   */
  constructor(worker, { concurrency = 1 } = {}) {
    super();
    if (typeof worker !== 'function') {
      throw new TypeError('worker must be a function');
    }
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError('concurrency must be a positive integer');
    }
    this._worker = worker;
    this._pending = [];
    this._running = 0;
    this._concurrency = concurrency;
  }

  /** Number of jobs currently executing. */
  get running() { return this._running; }

  /** Number of jobs waiting to start. */
  get size() { return this._pending.length; }

  /** Current maximum concurrency. */
  get concurrency() { return this._concurrency; }

  /**
   * Change the maximum concurrency at runtime.
   * If raising it allows queued jobs to start immediately, _drain() is called.
   * @param {number} n
   */
  set concurrency(n) {
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError('concurrency must be a positive integer');
    }
    this._concurrency = n;
    this._drain();
  }

  /** Add a job id to the queue. */
  push(jobId) {
    this._pending.push(jobId);
    this._drain();
  }

  _drain() {
    // JavaScript is single-threaded, so this while-loop is atomic: the condition
    // is evaluated and `_running` is incremented before any microtask can run.
    // Concurrent completions schedule separate setImmediate callbacks that each
    // run on their own event-loop tick — they never interleave with this loop.
    while (this._running < this._concurrency && this._pending.length > 0) {
      const jobId = this._pending.shift();
      this._running++;
      Promise.resolve()
        .then(() => this._worker(jobId))
        .catch((err) => this.emit('error', err, jobId))
        .finally(() => {
          this._running--;
          setImmediate(() => this._drain());
        });
    }
  }
}

module.exports = Queue;
