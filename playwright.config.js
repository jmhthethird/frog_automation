// @ts-check
'use strict';

const path = require('path');
const os   = require('os');

const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright configuration.
 *
 * The webServer block starts the Express server (not the full Electron app)
 * on a dedicated port with a fresh temp DATA_DIR so tests never pollute real
 * app data. The server is torn down automatically after all tests finish.
 */

const E2E_PORT    = 3097;
const E2E_DATA_DIR = path.join(os.tmpdir(), `frog-automation-e2e-${process.pid}`);

module.exports = defineConfig({
  testDir:  './tests/e2e',
  timeout:  30_000,

  expect: { timeout: 8_000 },

  // In CI retry once to absorb transient timing flakes.
  retries: process.env.CI ? 1 : 0,

  // Playwright worker count: keep at 1 so all tests share the same server
  // state (job IDs increment, profiles persist, etc.).
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    baseURL:    `http://localhost:${E2E_PORT}`,
    headless:   true,
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use:  { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the Express HTTP server before any tests and stop it afterwards.
  webServer: {
    command:              'node index.js',
    url:                  `http://localhost:${E2E_PORT}`,
    reuseExistingServer:  !process.env.CI,
    timeout:              15_000,
    env: {
      PORT:     String(E2E_PORT),
      DATA_DIR: E2E_DATA_DIR,
      NODE_ENV: 'test',
    },
  },
});
