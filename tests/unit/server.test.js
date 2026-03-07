'use strict';

/**
 * Tests for index.js bootstrapping:
 *   – startServer() binds the HTTP server and re-queues stale jobs
 *   – queue error handler logs without crashing
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ─── startServer ─────────────────────────────────────────────────────────────
describe('startServer()', () => {
  let dataDir;
  let server;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-server-test-'));
    process.env.DATA_DIR = dataDir;
    jest.resetModules();
  });

  afterAll(async () => {
    if (server && server.listening) {
      await new Promise((r) => server.close(r));
    }
    // Stop cron tasks so the event loop drains.
    const { app } = require('../../index.js');
    const s = app.get('scheduler');
    if (s) s.destroy();
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns a listening http.Server on port 0 (OS-assigned)', async () => {
    const { startServer } = require('../../index.js');
    server = await startServer(0);
    expect(server.listening).toBe(true);
    expect(server.address().port).toBeGreaterThan(0);
  });
});

// ─── stale job re-queuing ─────────────────────────────────────────────────────
describe('startServer() – stale job re-queuing', () => {
  let dataDir;
  let server;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-stale-test-'));
    process.env.DATA_DIR = dataDir;
    jest.resetModules();

    // Insert stale jobs BEFORE index.js is required so they exist in the DB
    // when startServer is called.
    const { db } = require('../../src/db');
    db.prepare(
      "INSERT INTO jobs (url, export_tabs, status) VALUES ('https://running.example.com', 'Internal:All', 'running')"
    ).run();
    db.prepare(
      "INSERT INTO jobs (url, export_tabs, status) VALUES ('https://queued.example.com', 'Internal:All', 'queued')"
    ).run();
  });

  afterAll(async () => {
    if (server && server.listening) {
      await new Promise((r) => server.close(r));
    }
    // Stop cron tasks so the event loop drains.
    const { app } = require('../../index.js');
    const s = app.get('scheduler');
    if (s) s.destroy();
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('re-queues running and queued jobs to "queued" status', async () => {
    // Spy on console.log BEFORE requiring index.js so we can capture the
    // "[startup] Re-queued N stale job(s)" message emitted synchronously
    // inside startServer().  We cannot check the final DB status because the
    // queue starts processing the re-queued jobs asynchronously immediately
    // after startServer() resolves.
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    jest.resetModules();
    const { startServer } = require('../../index.js');
    server = await startServer(0);

    const reQueueMsg = logSpy.mock.calls.find((args) =>
      String(args[0]).includes('[startup]') && String(args[0]).includes('Re-queued')
    );
    logSpy.mockRestore();

    expect(reQueueMsg).toBeTruthy();
    expect(reQueueMsg[0]).toMatch(/Re-queued 2 stale job/i);
  });
});

// ─── queue error handler ──────────────────────────────────────────────────────
describe('queue error handler', () => {
  let dataDir;
  let server;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-qerr-test-'));
    process.env.DATA_DIR = dataDir;
    jest.resetModules();
    const { startServer } = require('../../index.js');
    server = await startServer(0);
  });

  afterAll(async () => {
    if (server && server.listening) {
      await new Promise((r) => server.close(r));
    }
    const { app } = require('../../index.js');
    const s = app.get('scheduler');
    if (s) s.destroy();
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('logs to console.error without crashing when the queue emits an error', () => {
    const { app } = require('../../index.js');
    const queue = app.get('queue');

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    queue.emit('error', new Error('test queue error'), 99);

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[queue]'),
      expect.any(Error)
    );
    errSpy.mockRestore();
  });
});
