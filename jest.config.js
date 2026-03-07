'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',

  // Collect unit, route, and integration tests; E2E tests run via Playwright.
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/routes/**/*.test.js',
    '**/tests/integration/**/*.test.js',
  ],

  // Gather coverage from all application source files.
  // Exclude the Electron main process (requires Electron runtime to execute).
  collectCoverageFrom: [
    'index.js',
    'src/**/*.js',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/electron/',
    '/tests/',
  ],

  // Realistic thresholds — the only intentionally-uncovered lines are the
  // defence-in-depth security guards marked with `/* istanbul ignore next */`.
  coverageThreshold: {
    global: {
      statements: 90,
      branches:   80,
      functions:  90,
      lines:      90,
    },
  },

  coverageReporters: ['text', 'lcov', 'html'],

  // Give file-system-heavy tests (crawl, zip) extra time.
  testTimeout: 30_000,

  // Print a one-liner per test for easier CI log scanning.
  verbose: true,
};
