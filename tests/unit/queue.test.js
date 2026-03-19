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
});

// ─── push / _drain ────────────────────────────────────────────────────────────
describe('Queue – processing', () => {
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
});

// ─── Priority (pushLow) ──────────────────────────────────────────────────────
describe('Queue – priority (pushLow)', () => {
  it('processes pushLow jobs after push jobs', async () => {
    const order = [];
    let resolve1;
    const q = new Queue(async (id) => {
      order.push(id);
      if (id === 'first') {
        await new Promise((r) => { resolve1 = r; });
      }
      await delay(5);
    });

    // Start job 'first' so we can queue while it's running
    q.push('first');
    await settle(10);

    // Now enqueue a low-priority and a high-priority job while 'first' runs
    q.pushLow('cron-A');
    q.push('manual-B');

    resolve1(); // unblock the first job
    await settle(150);

    // manual-B should come before cron-A since push has higher priority
    expect(order).toEqual(['first', 'manual-B', 'cron-A']);
  });

  it('processes pushLow jobs in FIFO order among themselves', async () => {
    const order = [];
    let resolve1;
    const q = new Queue(async (id) => {
      order.push(id);
      if (id === 'blocker') {
        await new Promise((r) => { resolve1 = r; });
      }
    });

    q.push('blocker');
    await settle(10);

    q.pushLow(1);
    q.pushLow(2);
    q.pushLow(3);

    resolve1();
    await settle(100);

    expect(order).toEqual(['blocker', 1, 2, 3]);
  });

  it('drains low-priority queue when high-priority is empty', async () => {
    const order = [];
    const q = new Queue(async (id) => { order.push(id); });

    q.pushLow(10);
    q.pushLow(20);
    await settle(100);

    expect(order).toEqual([10, 20]);
  });

  it('interleaves correctly – new push jobs jump ahead of pending pushLow jobs', async () => {
    const order = [];
    let resolvers = {};
    const q = new Queue(async (id) => {
      order.push(id);
      await new Promise((r) => { resolvers[id] = r; });
    });

    q.push('a');
    await settle(10);

    // Queue low-priority jobs
    q.pushLow('low1');
    q.pushLow('low2');

    // Now add a high-priority job – should run before low1 and low2
    q.push('high1');

    resolvers['a'](); // unblock 'a'
    await settle(50);

    // high1 should have started
    expect(order[1]).toBe('high1');

    resolvers['high1']();
    await settle(50);
    resolvers['low1']();
    await settle(50);
    resolvers['low2']();
    await settle(50);

    expect(order).toEqual(['a', 'high1', 'low1', 'low2']);
  });
});

// ─── remove() ─────────────────────────────────────────────────────────────────
describe('Queue – remove()', () => {
  it('removes a pending job from the high-priority lane', async () => {
    const order = [];
    let resolve1;
    const q = new Queue(async (id) => {
      order.push(id);
      if (id === 'blocker') await new Promise((r) => { resolve1 = r; });
    });

    q.push('blocker');
    await settle(10);

    q.push('keep');
    q.push('remove-me');
    q.push('also-keep');

    q.remove('remove-me');

    resolve1();
    await settle(100);

    expect(order).toEqual(['blocker', 'keep', 'also-keep']);
  });

  it('removes a pending job from the low-priority lane', async () => {
    const order = [];
    let resolve1;
    const q = new Queue(async (id) => {
      order.push(id);
      if (id === 'blocker') await new Promise((r) => { resolve1 = r; });
    });

    q.push('blocker');
    await settle(10);

    q.pushLow('low-keep');
    q.pushLow('low-remove');
    q.pushLow('low-also-keep');

    q.remove('low-remove');

    resolve1();
    await settle(100);

    expect(order).toEqual(['blocker', 'low-keep', 'low-also-keep']);
  });

  it('is a no-op when the job is not in either lane', async () => {
    let resolve1;
    const q = new Queue(async () => {
      await new Promise((r) => { resolve1 = r; });
    });

    q.push(1);
    await settle(10); // job 1 starts running

    q.push(2);
    q.pushLow(3);
    // Should not throw when removing a non-existent id
    q.remove(999);
    expect(q._pending).toEqual([2]);
    expect(q._pendingLow).toEqual([3]);

    resolve1();
    await settle(100);
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
