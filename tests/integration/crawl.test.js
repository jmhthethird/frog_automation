'use strict';

/**
 * Integration test: real Screaming Frog CLI crawl + ZIP verification.
 *
 * This test is SKIPPED unless ALL of the following are true:
 *   1. Running on macOS (darwin) or Linux
 *   2. The SF launcher binary exists and is executable
 *   3. The env var RUN_SF_INTEGRATION=1 is set (opt-in to prevent accidental long runs)
 *
 * On Linux the launcher is expected at /usr/bin/ScreamingFrogSEOSpiderLauncher
 * (installed via scripts/install-sf-linux.sh).  Override with SF_LAUNCHER.
 *
 * No paid licence is required.  Screaming Frog runs in free mode (up to 500
 * URLs per crawl) without any licence file.  The install script always writes
 * the EULA acceptance to ~/.ScreamingFrogSEOSpider/spider.config so the
 * binary can run headlessly in free mode.
 *
 * When those conditions are met, the test:
 *   a) Starts a tiny local HTTP server with several pages / a redirect / a 404
 *   b) Submits a crawl job against it via the Frog Automation API
 *   c) Polls until the job completes or fails (3-minute timeout)
 *   d) Extracts the resulting ZIP and verifies:
 *        – crawler.log is present
 *        – At least one CSV file was produced
 *        – Every CSV file that exists has a valid non-empty header row
 *        – The crawled home-page URL appears in at least one CSV
 */

const fs             = require('fs');
const os             = require('os');
const path           = require('path');
const { execSync }   = require('child_process');
const { createTestSite } = require('../helpers/test-site');
const { makeApp }        = require('../helpers/app-factory');

// ── Guard: skip unless the right conditions are met ───────────────────────────
// Resolve the launcher path using the same platform-aware logic as crawler.js,
// so SF_LAUNCHER overrides work consistently across tests and the application.
const SF_LAUNCHER = process.env.SF_LAUNCHER ||
  (process.platform === 'linux'
    ? '/usr/bin/ScreamingFrogSEOSpiderLauncher'
    : '/Applications/Screaming Frog SEO Spider.app/Contents/MacOS/ScreamingFrogSEOSpiderLauncher');

const sfAvailable = (() => {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return false;
  try { fs.accessSync(SF_LAUNCHER, fs.constants.X_OK); return true; } catch { return false; }
})();

const integEnabled = process.env.RUN_SF_INTEGRATION === '1';

const maybeDescribe = (sfAvailable && integEnabled) ? describe : describe.skip;

// ─────────────────────────────────────────────────────────────────────────────
maybeDescribe('Screaming Frog integration crawl', () => {
  jest.setTimeout(3 * 60 * 1000); // 3-minute hard cap per test

  let site;
  let ctx;
  let extractDir;

  beforeAll(async () => {
    site = await createTestSite();
    ctx  = makeApp('sf-integration');
    extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-zip-extract-'));
  });

  afterAll(async () => {
    await site.stop();
    ctx.cleanup();
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  // ── Submit job ─────────────────────────────────────────────────────────────
  let jobId;

  it('submits a crawl job against the local test site', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: site.url })
      .set('Content-Type', 'application/json')
      .expect(201);

    expect(res.body.status).toBe('queued');
    jobId = res.body.id;
  });

  // ── Wait for completion ────────────────────────────────────────────────────
  it('job completes successfully within 3 minutes', async () => {
    expect(jobId).toBeDefined();

    const POLL_INTERVAL_MS = 5_000;
    const DEADLINE = Date.now() + 3 * 60 * 1000;

    let finalJob;
    while (Date.now() < DEADLINE) {
      const res = await ctx.request.get(`/api/jobs/${jobId}`);
      finalJob = res.body;
      if (finalJob.status === 'completed' || finalJob.status === 'failed') break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (!finalJob || (finalJob.status !== 'completed' && finalJob.status !== 'failed')) {
      throw new Error('Timed out waiting for job to finish');
    }

    if (finalJob.status === 'failed') {
      throw new Error(`Crawl job failed: ${finalJob.error}`);
    }

    expect(finalJob.status).toBe('completed');
    expect(finalJob.zip_path).toBeTruthy();
  });

  // ── ZIP structure ──────────────────────────────────────────────────────────
  it('produces a non-empty ZIP file', async () => {
    const res = await ctx.request.get(`/api/jobs/${jobId}`);
    const zipPath = res.body.zip_path;
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(fs.statSync(zipPath).size).toBeGreaterThan(0);
  });

  it('ZIP can be fully extracted without errors', async () => {
    const res = await ctx.request.get(`/api/jobs/${jobId}`);
    const zipPath = res.body.zip_path;
    // Will throw on extraction failure.
    execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`);
  });

  it('extracted ZIP contains crawler.log', () => {
    const log = findFile(extractDir, 'crawler.log');
    expect(log).not.toBeNull();
    const content = fs.readFileSync(log, 'utf8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toMatch(/\[INFO\]/);
  });

  it('extracted ZIP contains at least one CSV file', () => {
    const csvFiles = findFiles(extractDir, (f) => f.toLowerCase().endsWith('.csv'));
    expect(csvFiles.length).toBeGreaterThan(0);
  });

  it('every CSV file has a non-empty header row', () => {
    const csvFiles = findFiles(extractDir, (f) => f.toLowerCase().endsWith('.csv'));
    for (const csvPath of csvFiles) {
      const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
      const header = lines[0];
      expect(header.trim().length).toBeGreaterThan(0);
      // Headers should contain at least one comma (CSV format).
      expect(header).toContain(',');
    }
  });

  it('at least one CSV contains a URL from the crawled site', () => {
    const csvFiles = findFiles(extractDir, (f) => f.toLowerCase().endsWith('.csv'));
    const combined = csvFiles.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
    // The test site home page URL should appear somewhere.
    expect(combined).toContain(site.url);
  });

  it('ZIP download endpoint serves the file with correct Content-Disposition', async () => {
    const res = await ctx.request.get(`/api/jobs/${jobId}/download`).expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/i);
    expect(res.headers['content-disposition']).toMatch(/\.zip/i);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Recursively search for a file by name. Returns first match or null. */
function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

/** Recursively find all files matching a predicate. */
function findFiles(dir, predicate) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, predicate));
    } else if (predicate(entry.name)) {
      results.push(full);
    }
  }
  return results;
}
