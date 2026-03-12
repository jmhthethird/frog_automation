'use strict';

/**
 * Concurrent-crawl integration test: submits TWO crawl jobs simultaneously
 * and verifies that both complete successfully.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * Screaming Frog SEO Spider supports only one running instance at a time on a
 * given machine/user-account.  All instances share ~/.ScreamingFrogSEOSpider/,
 * including instance-lock files, application state, and the spider.config.
 * When two jobs run concurrently in *direct mode* they collide on that shared
 * directory, causing one or both to fail.
 *
 * Docker containerisation solves this: each crawl runs inside its own
 * ephemeral container which has a completely isolated filesystem (including its
 * own ~/.ScreamingFrogSEOSpider/).  The two SF JVM processes never see each
 * other, so both jobs complete successfully.
 *
 * GUARD CONDITIONS
 * ----------------
 * This test is SKIPPED unless ALL of the following are true:
 *   1. Running on Linux
 *   2. RUN_SF_INTEGRATION=1 is set (opt-in to prevent accidental long runs)
 *   3. SF_DOCKER_IMAGE is set to a valid, built Docker image name
 *      (build it with: bash scripts/build-sf-docker.sh)
 *   4. Docker daemon is reachable (`docker info` succeeds)
 *
 * To run this test:
 *   bash scripts/build-sf-docker.sh
 *   export SF_DOCKER_IMAGE=frog-automation-sf:latest
 *   export RUN_SF_INTEGRATION=1
 *   npx jest tests/integration/concurrent-crawl.test.js
 */

const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const { execSync } = require('child_process');
const { createTestSite } = require('../helpers/test-site');
const { makeApp }        = require('../helpers/app-factory');

// ── Guard conditions ──────────────────────────────────────────────────────────

const integEnabled  = process.env.RUN_SF_INTEGRATION === '1';
const dockerImage   = process.env.SF_DOCKER_IMAGE || '';

const dockerAvailable = (() => {
  if (!dockerImage) return false;
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
})();

const shouldRun     = integEnabled && dockerAvailable && process.platform === 'linux';
const maybeDescribe = shouldRun ? describe : describe.skip;

// ── Test suite ────────────────────────────────────────────────────────────────

const TEST_TIMEOUT_MS = 5 * 60 * 1000; // 5-minute hard cap per test

maybeDescribe('Concurrent crawl – Docker containerisation', () => {
  jest.setTimeout(TEST_TIMEOUT_MS);

  let site1;
  let site2;
  let ctx;
  let extractDir1;
  let extractDir2;

  beforeAll(async () => {
    // Two independent test sites bound to separate ephemeral ports.
    [site1, site2] = await Promise.all([createTestSite(), createTestSite()]);

    ctx = makeApp('sf-concurrent');

    // Raise the queue concurrency to 2 so both jobs start simultaneously.
    await ctx.request
      .patch('/api/settings')
      .send({ queue_concurrency: '2' })
      .set('Content-Type', 'application/json');

    extractDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-concurrent-zip1-'));
    extractDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-concurrent-zip2-'));
  });

  afterAll(async () => {
    await Promise.all([site1?.stop(), site2?.stop()]);
    ctx.cleanup();
    for (const d of [extractDir1, extractDir2]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  let jobId1;
  let jobId2;

  // ── Step 1: submit both jobs back-to-back ──────────────────────────────────
  it('submits two crawl jobs simultaneously', async () => {
    const [res1, res2] = await Promise.all([
      ctx.request.post('/api/jobs')
        .send({ url: site1.url })
        .set('Content-Type', 'application/json'),
      ctx.request.post('/api/jobs')
        .send({ url: site2.url })
        .set('Content-Type', 'application/json'),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.status).toBe('queued');
    expect(res2.body.status).toBe('queued');

    jobId1 = res1.body.id;
    jobId2 = res2.body.id;
  });

  // ── Step 2: both jobs must reach 'running' simultaneously ─────────────────
  it('both jobs start running at the same time (concurrent, not serialised)', async () => {
    expect(jobId1).toBeDefined();
    expect(jobId2).toBeDefined();

    // Poll until both reach 'running' (or beyond) — up to 60 s.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const [r1, r2] = await Promise.all([
        ctx.request.get(`/api/jobs/${jobId1}`),
        ctx.request.get(`/api/jobs/${jobId2}`),
      ]);
      const s1 = r1.body.status;
      const s2 = r2.body.status;
      if (
        (s1 === 'running' || s1 === 'completed' || s1 === 'failed') &&
        (s2 === 'running' || s2 === 'completed' || s2 === 'failed')
      ) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }

    const [r1, r2] = await Promise.all([
      ctx.request.get(`/api/jobs/${jobId1}`),
      ctx.request.get(`/api/jobs/${jobId2}`),
    ]);
    // Both should have been picked up by the queue — neither should still be 'queued'.
    expect(r1.body.status).not.toBe('queued');
    expect(r2.body.status).not.toBe('queued');
  });

  // ── Step 3: both jobs must complete without error ─────────────────────────
  it('both jobs complete successfully within 5 minutes', async () => {
    expect(jobId1).toBeDefined();
    expect(jobId2).toBeDefined();

    const POLL_MS = 5_000;
    const deadline = Date.now() + TEST_TIMEOUT_MS - 30_000; // leave 30 s headroom

    let job1;
    let job2;
    while (Date.now() < deadline) {
      [job1, job2] = await Promise.all([
        ctx.request.get(`/api/jobs/${jobId1}`).then((r) => r.body),
        ctx.request.get(`/api/jobs/${jobId2}`).then((r) => r.body),
      ]);
      const done1 = job1.status === 'completed' || job1.status === 'failed';
      const done2 = job2.status === 'completed' || job2.status === 'failed';
      if (done1 && done2) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }

    if (job1.status === 'failed') throw new Error(`Job 1 failed: ${job1.error}`);
    if (job2.status === 'failed') throw new Error(`Job 2 failed: ${job2.error}`);

    expect(job1.status).toBe('completed');
    expect(job2.status).toBe('completed');
    expect(job1.zip_path).toBeTruthy();
    expect(job2.zip_path).toBeTruthy();
  });

  // ── Step 4: verify both ZIPs are well-formed ──────────────────────────────
  it('both ZIPs contain a crawler.log and at least one CSV', async () => {
    const pairs = [
      [jobId1, extractDir1],
      [jobId2, extractDir2],
    ];

    for (const [jobId, extractDir] of pairs) {
      const res     = await ctx.request.get(`/api/jobs/${jobId}`);
      const zipPath = res.body.zip_path;

      expect(fs.existsSync(zipPath)).toBe(true);
      expect(fs.statSync(zipPath).size).toBeGreaterThan(0);

      execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`);

      const log = findFile(extractDir, 'crawler.log');
      expect(log).not.toBeNull();
      expect(fs.readFileSync(log, 'utf8')).toMatch(/\[INFO\]/);

      const csvFiles = findFiles(extractDir, (f) => f.toLowerCase().endsWith('.csv'));
      expect(csvFiles.length).toBeGreaterThan(0);
    }
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
