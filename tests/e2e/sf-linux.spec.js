// @ts-check
'use strict';

/**
 * Integration test: Linux Screaming Frog SEO Spider real crawl of a local
 * deterministic test site, followed by Playwright UI verification.
 *
 * This test is SKIPPED unless ALL of the following are true:
 *   1. Running on Linux
 *   2. The SF launcher binary exists and is executable
 *      (default: /usr/bin/ScreamingFrogSEOSpiderLauncher; override with SF_LAUNCHER)
 *   3. The env var RUN_SF_INTEGRATION=1 is set (opt-in to prevent accidental long runs)
 *
 * No paid licence is required.  Screaming Frog runs in free mode (up to 500
 * URLs per crawl) without any licence file.  The install script always writes
 * the EULA acceptance to ~/.ScreamingFrogSEOSpider/spider.config so the
 * binary can run headlessly in free mode.
 *
 * When those conditions are met, the test:
 *   a) Starts a tiny local HTTP server (a few pages + a redirect + a 404)
 *   b) Submits a crawl job for the local site via the Frog Automation UI
 *   c) Polls the API until the job completes or fails (3-minute cap)
 *   d) Verifies the UI reflects the completed job:
 *        – Job row appears in the jobs table
 *        – Status badge shows "completed"
 *        – Clicking View opens the detail panel containing the crawled URL
 *        – Log output section is visible in the detail panel
 *        – Download button/link is present for the completed job
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { createTestSite } = require('../helpers/test-site');

// ── Guard: resolve launcher path using the same logic as crawler.js ───────────
const SF_LAUNCHER = process.env.SF_LAUNCHER || '/usr/bin/ScreamingFrogSEOSpiderLauncher';

const sfOnLinux = (() => {
  if (process.platform !== 'linux') return false;
  try { fs.accessSync(SF_LAUNCHER, fs.constants.X_OK); return true; } catch { return false; }
})();

const integEnabled = process.env.RUN_SF_INTEGRATION === '1';

// ── Constants ─────────────────────────────────────────────────────────────────
const JOB_TIMEOUT_MS = 3 * 60 * 1000;  // 3 minutes
const POLL_INTERVAL  = 5_000;           // poll every 5 s

// ── Shared state (tests run sequentially; module-level var shared in worker) ──
let site;
let jobId;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Navigate to home, locate the test-site job row, open the detail panel. */
async function openJobPanel(page) {
  await page.goto('/');
  const row = page.locator('table tr', { hasText: site.url }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.locator('button', { hasText: 'View' }).click();
  await expect(page.locator('#detail-panel')).toBeVisible({ timeout: 5_000 });
}

// ── Suite ─────────────────────────────────────────────────────────────────────
const maybeDescribe = (sfOnLinux && integEnabled) ? test.describe : test.describe.skip;

maybeDescribe('Linux SF app – crawl local test site and verify UI', () => {
  // Serial mode: abort remaining tests if one fails, and share jobId state.
  test.describe.configure({ mode: 'serial', timeout: JOB_TIMEOUT_MS + 60_000 });

  test.beforeAll(async () => {
    site = await createTestSite();
  });

  test.afterAll(async () => {
    if (site) await site.stop();
  });

  // ── Step 1: submit the job via the UI ──────────────────────────────────────
  test('submits a crawl job for the local test site and sees it queued', async ({ page }) => {
    await page.goto('/');

    // Choose "No profile" so no .seospiderconfig upload is needed.
    await page.locator('#prof-none').check();
    await page.locator('#job-url').fill(site.url);
    await page.locator('#submit-btn').click();

    const msg = page.locator('#submit-msg');
    await expect(msg).toBeVisible({ timeout: 10_000 });
    await expect(msg).toHaveText(/job #\d+ queued/i);

    // Capture the assigned job ID so subsequent tests can poll by ID.
    const text = await msg.textContent();
    const m = text.match(/job #(\d+)/i);
    expect(m).not.toBeNull();
    jobId = Number(m[1]);

    // The job row should appear in the jobs table.
    await expect(page.locator('table tr', { hasText: site.url }).first()).toBeVisible({ timeout: 10_000 });
  });

  // ── Step 2: wait for the crawl to finish ──────────────────────────────────
  test('job completes within 3 minutes', async ({ request, baseURL }) => {
    expect(jobId).toBeDefined();

    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let job;

    while (Date.now() < deadline) {
      const res = await request.get(`${baseURL}/api/jobs/${jobId}`);
      job = await res.json();
      if (job.status === 'completed' || job.status === 'failed') break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    if (!job || (job.status !== 'completed' && job.status !== 'failed')) {
      throw new Error('Timed out waiting for crawl job to finish');
    }
    if (job.status === 'failed') {
      throw new Error(`Crawl job failed: ${job.error}`);
    }

    expect(job.status).toBe('completed');
  });

  // ── Step 3: UI verification ────────────────────────────────────────────────
  test('job row shows "completed" status badge', async ({ page }) => {
    await page.goto('/');

    const row = page.locator('table tr', { hasText: site.url }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('.badge')).toHaveText(/completed/i);
  });

  test('clicking View opens the detail panel with the crawled URL', async ({ page }) => {
    await openJobPanel(page);
    await expect(page.locator('#detail-panel')).toContainText(site.url);
  });

  test('detail panel shows a log output section', async ({ page }) => {
    await openJobPanel(page);
    await expect(page.locator('#log-output')).toBeVisible({ timeout: 5_000 });
  });

  test('Download button is visible in the detail panel for the completed job', async ({ page }) => {
    await openJobPanel(page);

    // A completed job exposes a download anchor or button in the detail panel.
    const downloadEl = page.locator('#detail-panel')
      .locator('a[href*="download"], button')
      .filter({ hasText: /download/i })
      .first();
    await expect(downloadEl).toBeVisible({ timeout: 5_000 });
  });
});
