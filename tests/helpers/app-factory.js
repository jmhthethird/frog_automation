'use strict';

/**
 * app-factory.js
 *
 * Creates a fully isolated Frog Automation app instance for each test suite.
 * Each call uses jest.resetModules() to get a fresh Express app backed by an
 * independent SQLite database in a temporary directory.
 *
 * Usage inside a test file:
 *
 *   const { makeApp } = require('../helpers/app-factory');
 *   let ctx;
 *   beforeAll(() => { ctx = makeApp(); });
 *   afterAll(() => ctx.cleanup());
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

/**
 * @param {string} [label]  Used in the temp-dir name for easier debugging.
 * @returns {{ app, request, dataDir, cleanup }}
 */
function makeApp(label = 'app') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `frog-test-${label}-`));

  // DATA_DIR must be set before any of our modules are loaded so that db.js
  // opens the database in the right place.
  process.env.DATA_DIR = dataDir;

  // Clear the module registry so that every require() below gets a fresh copy
  // of every module (new DB connection, fresh Express app, etc.).
  jest.resetModules();

  const { app, startServer } = require('../../index.js');
  // Use supertest to create a lightweight in-process HTTP client.
  // Passing the express `app` directly avoids needing a fixed port.
  const supertest = require('supertest');
  const request = supertest(app);

  return {
    app,
    request,
    startServer,
    dataDir,
    cleanup() {
      // Stop all active cron tasks so the event loop can drain cleanly.
      const appScheduler = app.get('scheduler');
      if (appScheduler && typeof appScheduler.destroy === 'function') {
        appScheduler.destroy();
      }
      delete process.env.DATA_DIR;
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* already gone */ }
    },
  };
}

module.exports = { makeApp };
