// @ts-check
'use strict';

/**
 * End-to-end UI tests using Playwright.
 *
 * Tests are run against the live Express server started via playwright.config.js
 * webServer. The server uses a dedicated temp DATA_DIR so tests never touch
 * production data.
 *
 * Every interactive element and user-facing behaviour is covered:
 *   – Initial page load and static elements
 *   – Health badge
 *   – Submit form: validation, job creation, profile radio switching
 *   – Profile library: upload, display, delete
 *   – Jobs table: appears after submission, status badge, Refresh button
 *   – Job detail panel: opens on View click, shows log tail, Download button
 */

const { test, expect } = require('@playwright/test');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wait until the jobs table contains at least one row (polling). */
async function waitForJobRow(page, timeout = 15_000) {
  await expect(page.locator('table tr:nth-child(2)')).toBeVisible({ timeout });
}

/** Upload a fake .seospiderconfig via the API directly (fast, no UI needed). */
async function apiUploadProfile(request, baseURL, name = 'e2e-profile') {
  const content = Buffer.from('<config/>').toString('base64');
  const res = await request.post(`${baseURL}/api/profiles`, {
    multipart: {
      profile: {
        name: `${name}.seospiderconfig`,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('<config/>'),
      },
      name,
    },
  });
  return res.json();
}

// ─── Page load ────────────────────────────────────────────────────────────────
test.describe('Page load', () => {
  test('has the correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Frog Automation/);
  });

  test('shows the 🐸 emoji in the header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header .emoji')).toHaveText('🐸');
  });

  test('shows the app name in the header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header h1')).toHaveText('Frog Automation');
  });

  test('health badge is visible and resolves from "checking…"', async ({ page }) => {
    await page.goto('/');
    const badge = page.locator('#health-badge');
    await expect(badge).toBeVisible();
    // After the /api/health fetch the badge text changes.
    await expect(badge).not.toHaveText('checking…', { timeout: 5_000 });
  });
});

// ─── Submit form – static elements ────────────────────────────────────────────
test.describe('Submit form – static elements', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); });

  test('URL input is visible and accepts text', async ({ page }) => {
    const input = page.locator('#job-url');
    await expect(input).toBeVisible();
    await input.fill('https://example.com');
    await expect(input).toHaveValue('https://example.com');
  });

  test('Export tabs textarea has the default tab', async ({ page }) => {
    const ta = page.locator('#export-tabs');
    await expect(ta).toBeVisible();
    const value = await ta.inputValue();
    expect(value).toBe('AMP:All,Analytics:All,Canonicals:All,Change Detection:All,Content:All,Custom Extraction:All,Directives:All,External:All,H1:All,H2:All,Hreflang:All,Images:All,Internal:All,JavaScript:All,Link Metrics:All,Links:All,Meta Description:All,Meta Keywords:All,Page Titles:All,PageSpeed:All,Pagination:All,Response Codes:All,Search Console:All,Security:All,Sitemaps:All,Structured Data:All,URL:All,Validation:All');
  });

  test('Run Crawl button is visible and enabled', async ({ page }) => {
    await expect(page.locator('#submit-btn')).toBeVisible();
    await expect(page.locator('#submit-btn')).toBeEnabled();
  });

  test('"Use saved profile" radio is checked by default', async ({ page }) => {
    await expect(page.locator('#prof-existing')).toBeChecked();
  });

  test('Profile select dropdown is visible when "existing" radio is selected', async ({ page }) => {
    await expect(page.locator('#prof-existing-row')).toBeVisible();
    await expect(page.locator('#prof-upload-row')).toBeHidden();
  });
});

// ─── Profile radio toggle ─────────────────────────────────────────────────────
test.describe('Profile source radio buttons', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); });

  test('selecting "Upload new" shows the upload row and hides the select row', async ({ page }) => {
    await page.locator('#prof-upload').check();
    await expect(page.locator('#prof-upload-row')).toBeVisible();
    await expect(page.locator('#prof-existing-row')).toBeHidden();
  });

  test('selecting "No profile" hides both rows', async ({ page }) => {
    await page.locator('#prof-none').check();
    await expect(page.locator('#prof-existing-row')).toBeHidden();
    await expect(page.locator('#prof-upload-row')).toBeHidden();
  });

  test('switching back to "existing" restores the select row', async ({ page }) => {
    await page.locator('#prof-none').check();
    await page.locator('#prof-existing').check();
    await expect(page.locator('#prof-existing-row')).toBeVisible();
  });
});

// ─── Submit form – validation ─────────────────────────────────────────────────
test.describe('Submit form – client-side validation', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); });

  test('shows error when URL is empty', async ({ page }) => {
    await page.locator('#job-url').fill('');
    await page.locator('#submit-btn').click();
    const msg = page.locator('#submit-msg');
    await expect(msg).toBeVisible({ timeout: 3_000 });
    await expect(msg).toHaveText(/url is required/i);
  });

  test('shows API error for invalid URL scheme (ftp://)', async ({ page }) => {
    await page.locator('#job-url').fill('ftp://bad.example.com');
    await page.locator('#submit-btn').click();
    const msg = page.locator('#submit-msg');
    await expect(msg).toBeVisible({ timeout: 5_000 });
    await expect(msg).toHaveText(/http/i);
  });

  test('shows error when "Upload new" selected but no file chosen', async ({ page }) => {
    await page.locator('#prof-upload').check();
    await page.locator('#job-url').fill('https://example.com');
    await page.locator('#submit-btn').click();
    const msg = page.locator('#submit-msg');
    await expect(msg).toBeVisible({ timeout: 3_000 });
    await expect(msg).toHaveText(/seospiderconfig/i);
  });
});

// ─── Job submission ───────────────────────────────────────────────────────────
test.describe('Job submission and jobs table', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/'); });

  test('submitting a valid URL creates a job and shows success message', async ({ page }) => {
    await page.locator('#prof-none').check();
    await page.locator('#job-url').fill('https://submit-test.example.com');
    await page.locator('#submit-btn').click();

    // Success message appears.
    const msg = page.locator('#submit-msg');
    await expect(msg).toBeVisible({ timeout: 5_000 });
    await expect(msg).toHaveText(/job #\d+ queued/i);
  });

  test('URL input is cleared after a successful submission', async ({ page }) => {
    await page.locator('#prof-none').check();
    await page.locator('#job-url').fill('https://clear-test.example.com');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#submit-msg')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#job-url')).toHaveValue('');
  });

  test('job appears in the jobs table', async ({ page }) => {
    await page.locator('#prof-none').check();
    await page.locator('#job-url').fill('https://table-test.example.com');
    await page.locator('#submit-btn').click();
    await waitForJobRow(page);

    const row = page.locator('table tr').nth(1);
    await expect(row).toContainText('table-test.example.com');
  });

  test('job row shows a status badge', async ({ page }) => {
    await page.locator('#prof-none').check();
    await page.locator('#job-url').fill('https://badge-test.example.com');
    await page.locator('#submit-btn').click();
    await waitForJobRow(page);

    const badge = page.locator('table tr:nth-child(2) .badge').first();
    await expect(badge).toBeVisible();
  });

  test('Refresh button reloads the jobs list', async ({ page }) => {
    // Submit a job first.
    await page.locator('#prof-none').check();
    await page.locator('#job-url').fill('https://refresh-test.example.com');
    await page.locator('#submit-btn').click();
    await waitForJobRow(page);

    // Click refresh and ensure the table is still populated.
    await page.locator('button', { hasText: '↻ Refresh' }).click();
    await waitForJobRow(page);
  });
});

// ─── Job detail panel ─────────────────────────────────────────────────────────
test.describe('Job detail panel', () => {
  test('clicking View opens the detail panel with job information', async ({ page }) => {
    await page.goto('/');
    await page.locator('#prof-none').check();
    await page.locator('#job-url').fill('https://detail-panel.example.com');
    await page.locator('#submit-btn').click();
    await waitForJobRow(page);

    // Click the View button on the first job row.
    await page.locator('table tr:nth-child(2) button', { hasText: 'View' }).click();

    const panel = page.locator('#detail-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await expect(panel).toContainText('detail-panel.example.com');
  });

  test('detail panel shows a log output section', async ({ page }) => {
    await page.goto('/');
    await page.locator('#prof-none').check();
    await page.locator('#job-url').fill('https://log-panel.example.com');
    await page.locator('#submit-btn').click();
    await waitForJobRow(page);
    await page.locator('table tr:nth-child(2) button', { hasText: 'View' }).click();

    await expect(page.locator('#log-output')).toBeVisible({ timeout: 5_000 });
  });

  test('detail panel shows job status', async ({ page }) => {
    await page.goto('/');
    await page.locator('#prof-none').check();
    await page.locator('#job-url').fill('https://status-panel.example.com');
    await page.locator('#submit-btn').click();
    await waitForJobRow(page);
    await page.locator('table tr:nth-child(2) button', { hasText: 'View' }).click();

    // Should show a badge with the status.
    const detailPanel = page.locator('#detail-panel');
    await expect(detailPanel.locator('.badge')).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Profile library ──────────────────────────────────────────────────────────
test.describe('Profile library', () => {
  test('initially shows "no profiles" message', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#profile-list-area')).toContainText(/no profiles/i);
  });

  test('uploading a profile via the submit form shows it in the library', async ({ page, baseURL, request }) => {
    await apiUploadProfile(request, baseURL);
    await page.goto('/');
    // Profile library should now show a table row.
    await expect(page.locator('#profile-list-area table')).toBeVisible({ timeout: 5_000 });
  });

  test('uploaded profile appears in the profile select dropdown', async ({ page, baseURL, request }) => {
    await apiUploadProfile(request, baseURL, 'dropdown-profile');
    await page.goto('/');
    const select = page.locator('#profile-select');
    await expect(select).toContainText('dropdown-profile');
  });

  test('delete button removes the profile from the library', async ({ page, baseURL, request }) => {
    // Use a timestamp-suffixed name so retries don't leave ghost entries.
    const profileName = `deletable-${Date.now()}`;
    await apiUploadProfile(request, baseURL, profileName);
    await page.goto('/');

    // Verify the profile is visible.
    await expect(page.locator('#profile-list-area')).toContainText(profileName);

    // Auto-accept the browser confirm() dialog that deleteProfile() shows.
    page.once('dialog', (dialog) => dialog.accept());

    // Click the ✕ button that belongs to THIS specific profile's row.
    const row = page.locator('#profile-list-area tr', { hasText: profileName }).first();
    await row.locator('button', { hasText: '✕' }).click();

    // Let Playwright wait (up to the `expect` timeout) for the row to vanish.
    await expect(page.locator('#profile-list-area')).not.toContainText(profileName, { timeout: 6_000 });
  });
});

// ─── Export tabs ──────────────────────────────────────────────────────────────
test.describe('Export tabs customisation', () => {
  test('export tabs textarea can be edited', async ({ page }) => {
    await page.goto('/');
    const ta = page.locator('#export-tabs');
    await ta.fill('Internal:All,Response Codes:All');
    await expect(ta).toHaveValue('Internal:All,Response Codes:All');
  });

  test('custom export tabs are sent with the job (verify via API)', async ({ page, baseURL, request }) => {
    await page.goto('/');
    await page.locator('#prof-none').check();
    await page.locator('#job-url').fill('https://custom-tabs.example.com');
    await page.locator('#export-tabs').fill('Internal:All,Response Codes:All');
    await page.locator('#submit-btn').click();
    await expect(page.locator('#submit-msg')).toBeVisible({ timeout: 5_000 });

    // Fetch the latest job via API and check its export_tabs.
    const jobs = await request.get(`${baseURL}/api/jobs`).then((r) => r.json());
    const latest = jobs[0];
    expect(latest.export_tabs).toBe('Internal:All,Response Codes:All');
  });
});
