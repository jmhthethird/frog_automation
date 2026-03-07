'use strict';

const { computeNextRun, validateCronExpression, scheduler } = require('../../src/scheduler');

// ─── validateCronExpression() ─────────────────────────────────────────────────
describe('validateCronExpression()', () => {
  it('returns true for a valid 5-field cron expression', () => {
    expect(validateCronExpression('0 * * * *')).toBe(true);
    expect(validateCronExpression('*/5 * * * *')).toBe(true);
    expect(validateCronExpression('0 2 * * 1-5')).toBe(true);
  });

  it('returns false for an invalid expression', () => {
    expect(validateCronExpression('invalid')).toBe(false);
    expect(validateCronExpression('')).toBe(false);
    expect(validateCronExpression('99 * * * *')).toBe(false);
  });
});

// ─── computeNextRun() ────────────────────────────────────────────────────────
describe('computeNextRun()', () => {
  it('returns a valid ISO 8601 datetime string', () => {
    const result = computeNextRun('0 * * * *');
    expect(typeof result).toBe('string');
    expect(() => new Date(result)).not.toThrow();
    expect(new Date(result).toISOString()).toBe(result);
  });

  it('returns a datetime in the future', () => {
    const result = computeNextRun('0 * * * *');
    expect(new Date(result).getTime()).toBeGreaterThan(Date.now());
  });

  it('computes the correct next occurrence for a specific expression', () => {
    // "0 0 * * *" runs at midnight; next should be after now.
    const result = computeNextRun('0 0 * * *');
    const next = new Date(result);
    expect(next.getMinutes()).toBe(0);
    expect(next.getSeconds()).toBe(0);
  });
});

// ─── Scheduler – reschedule() ────────────────────────────────────────────────
describe('Scheduler – reschedule()', () => {
  const os   = require('os');
  const path = require('path');
  const fs   = require('fs');

  let dataDir;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-scheduler-test-'));
    process.env.DATA_DIR = dataDir;
    jest.resetModules();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('resets the job status to "scheduled" and updates next_run_at', () => {
    const { db } = require('../../src/db');
    const { scheduler: s, computeNextRun: cnr } = require('../../src/scheduler');

    // Insert a job that just completed.
    const expression = '0 * * * *';
    const row = db.prepare(
      "INSERT INTO jobs (url, export_tabs, status, cron_expression) VALUES ('https://cron.example.com', 'Internal:All', 'completed', ?)"
    ).run(expression);

    // Reschedule should reset it.
    s.reschedule(row.lastInsertRowid, expression);

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(row.lastInsertRowid);
    expect(job.status).toBe('scheduled');
    expect(job.next_run_at).toBeTruthy();
    expect(new Date(job.next_run_at).getTime()).toBeGreaterThan(Date.now());

    // Clean up cron task.
    s.destroy();
  });
});

// ─── Scheduler – register() / unregister() ───────────────────────────────────
describe('Scheduler – register() / unregister()', () => {
  const os   = require('os');
  const path = require('path');
  const fs   = require('fs');

  let dataDir;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-scheduler-reg-'));
    process.env.DATA_DIR = dataDir;
    jest.resetModules();
  });

  afterAll(() => {
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('register() and unregister() do not throw', () => {
    const { scheduler: s } = require('../../src/scheduler');
    // Supply a dummy queue so init does not crash.
    s.init({ push: () => {} });

    expect(() => s.register(1, '0 * * * *')).not.toThrow();
    expect(() => s.unregister(1)).not.toThrow();
    // Calling unregister on an unknown id is a no-op.
    expect(() => s.unregister(999)).not.toThrow();
    s.destroy();
  });

  it('register() is safe to call multiple times for the same job id', () => {
    const { scheduler: s } = require('../../src/scheduler');
    expect(() => {
      s.register(2, '0 * * * *');
      s.register(2, '*/5 * * * *');
    }).not.toThrow();
    s.destroy();
  });
});
