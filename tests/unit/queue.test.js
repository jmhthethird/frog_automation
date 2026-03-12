'use strict';

const Queue = require('../../src/queue');

// ─── Constructor ──────────────────────────────────────────────────────────────
describe('Queue – constructor', () => {
  it('throws TypeError when worker is not a function', () => {
    expect(() => new Queue('not-a-function')).toThrow(TypeError);
    expect(() => new Queue(null)).toThrow(TypeError);
    expect(() => new Queue(42)).toThrow(TypeError);
  });

  it('accepts a function as worker', () => {
    expect(() => new Queue(() => {})).not.toThrow();
  });

  it('throws RangeError when concurrency < 1', () => {
    expect(() => new Queue(() => {}, { concurrency: 0 })).toThrow(RangeError);
    expect(() => new Queue(() => {}, { concurrency: -1 })).toThrow(RangeError);
    expect(() => new Queue(() => {}, { concurrency: 1.5 })).toThrow(RangeError);
  });

  it('accepts a valid concurrency option', () => {
    expect(() => new Queue(() => {}, { concurrency: 3 })).not.toThrow();
  });
});

// ─── push / _drain ────────────────────────────────────────────────────────────
describe('Queue – processing (concurrency=1)', () => {
  it('calls the worker with the pushed job id', async () => {
    const called = [];
    const q = new Queue(async (id) => called.push(id));

    q.push(10);
    await settle();

    expect(called).toEqual([10]);
  });

  it('processes multiple jobs in FIFO order', async () => {
    const order = [];
    const q = new Queue(async (id) => {
      order.push(id);
      await delay(5);
    });

    q.push(1);
    q.push(2);
    q.push(3);
    await settle(100);

    expect(order).toEqual([1, 2, 3]);
  });

  it('runs only one job at a time (no concurrent execution)', async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const q = new Queue(async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await delay(15);
      concurrentCount--;
    });

    q.push(1);
    q.push(2);
    q.push(3);
    await settle(200);

    expect(maxConcurrent).toBe(1);
  });

  it('does nothing when _drain is called with an empty pending list', async () => {
    const called = [];
    const q = new Queue(async (id) => called.push(id));

    // No push – drain should be a no-op
    q._drain();
    await settle(30);

    expect(called).toHaveLength(0);
  });

  it('does not start a new job while one is running', async () => {
    const starts = [];
    let resolve1;
    const q = new Queue(async (id) => {
      starts.push(id);
      if (id === 1) {
        await new Promise((r) => { resolve1 = r; });
      }
    });

    q.push(1);
    await settle(10);  // job 1 is now running and blocked

    q.push(2);
    await settle(10);  // job 2 should be pending, not yet started

    expect(starts).toEqual([1]);  // job 2 not started yet

    resolve1();          // unblock job 1
    await settle(50);    // job 2 should now have run

    expect(starts).toEqual([1, 2]);
  });
});

// ─── Concurrent processing ────────────────────────────────────────────────────
describe('Queue – concurrency > 1', () => {
  it('exposes running and size getters', async () => {
    let resolveJob;
    const q = new Queue(async () => {
      await new Promise((r) => { resolveJob = r; });
    }, { concurrency: 2 });

    expect(q.running).toBe(0);
    expect(q.size).toBe(0);

    q.push(1);
    q.push(2);
    q.push(3);
    await settle(20);

    expect(q.running).toBe(2);  // 2 running
    expect(q.size).toBe(1);     // 1 waiting

    resolveJob();
    await settle(50);
    resolveJob();
    await settle(50);
    resolveJob();
    await settle(50);
  });

  it('runs up to concurrency jobs simultaneously', async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const q = new Queue(async () => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await delay(20);
      concurrentCount--;
    }, { concurrency: 3 });

    q.push(1);
    q.push(2);
    q.push(3);
    q.push(4);
    q.push(5);
    await settle(300);

    expect(maxConcurrent).toBe(3);
  });

  it('processes all jobs even when concurrency > total jobs', async () => {
    const completed = [];
    const q = new Queue(async (id) => {
      await delay(5);
      completed.push(id);
    }, { concurrency: 5 });

    q.push(1);
    q.push(2);
    await settle(100);

    expect(completed).toHaveLength(2);
    expect(completed).toContain(1);
    expect(completed).toContain(2);
  });

  it('concurrency setter starts queued jobs immediately', async () => {
    const started = [];
    let blockAll = true;
    const q = new Queue(async (id) => {
      started.push(id);
      while (blockAll) await delay(5);
    }, { concurrency: 1 });

    q.push(1);
    q.push(2);
    q.push(3);
    await settle(30);

    expect(started).toHaveLength(1);  // only 1 running with concurrency=1

    q.concurrency = 3;  // raise the limit
    await settle(30);

    expect(started).toHaveLength(3);  // all 3 now running

    blockAll = false;
    await settle(50);
  });

  it('concurrency setter throws on invalid value', () => {
    const q = new Queue(async () => {});
    expect(() => { q.concurrency = 0; }).toThrow(RangeError);
    expect(() => { q.concurrency = -1; }).toThrow(RangeError);
    expect(() => { q.concurrency = 1.5; }).toThrow(RangeError);
  });

  it('exposes concurrency getter', () => {
    const q = new Queue(async () => {}, { concurrency: 4 });
    expect(q.concurrency).toBe(4);
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────
describe('Queue – error handling', () => {
  it('emits "error" event when the worker throws synchronously', async () => {
    const q = new Queue(() => { throw new Error('sync error'); });
    const errors = [];
    q.on('error', (err, id) => errors.push({ err, id }));

    q.push(99);
    await settle();

    expect(errors).toHaveLength(1);
    expect(errors[0].err.message).toBe('sync error');
    expect(errors[0].id).toBe(99);
  });

  it('emits "error" event when the worker rejects', async () => {
    const q = new Queue(async () => { throw new Error('async error'); });
    const errors = [];
    q.on('error', (err, id) => errors.push({ err, id }));

    q.push(7);
    await settle();

    expect(errors).toHaveLength(1);
    expect(errors[0].err.message).toBe('async error');
    expect(errors[0].id).toBe(7);
  });

  it('continues processing subsequent jobs after a worker error', async () => {
    const results = [];
    let call = 0;
    const q = new Queue(async (id) => {
      call++;
      if (call === 1) throw new Error('first fails');
      results.push(id);
    });
    q.on('error', () => {}); // suppress unhandled error event

    q.push(1);
    q.push(2);
    await settle(150);

    expect(results).toEqual([2]);
  });

  it('handles multiple consecutive errors', async () => {
    const errors = [];
    const q = new Queue(async () => { throw new Error('always fails'); });
    q.on('error', (err) => errors.push(err.message));

    q.push(1);
    q.push(2);
    await settle(150);

    expect(errors).toHaveLength(2);
  });

  it('continues processing after a worker error under concurrent load', async () => {
    const completed = [];
    let calls = 0;
    const q = new Queue(async (id) => {
      calls++;
      if (calls <= 2) throw new Error('fails');
      completed.push(id);
    }, { concurrency: 2 });
    q.on('error', () => {});

    q.push(1);
    q.push(2);
    q.push(3);
    q.push(4);
    await settle(300);

    expect(completed).toEqual(expect.arrayContaining([3, 4]));
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait enough micro-ticks for promises + setImmediate chains to flush. */
function settle(ms = 50) {
  return delay(ms);
}
