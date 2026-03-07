const { chromium } = require('@playwright/test');
const fs = require('fs');

// Read original HTML and inject mocks
const html = fs.readFileSync('/tmp/ui_render/index_mock.html', 'utf8');
const mockScript = `
<script>
const MOCK_PROFILES = [
  { id: 1, name: "Default", filename: "default.seospiderconfig", created_at: "2026-03-07T00:00:00" },
  { id: 2, name: "E-commerce", filename: "ecommerce.seospiderconfig", created_at: "2026-03-06T12:00:00" }
];
const MOCK_JOBS = [
  { id: 3, url: "https://example.com", profile_name: "Default", status: "completed", created_at: "2026-03-07T01:00:00" },
  { id: 2, url: "https://shop.example.com", profile_name: "E-commerce", status: "running", created_at: "2026-03-07T00:50:00" },
  { id: 1, url: "https://blog.example.com", profile_name: null, status: "queued", created_at: "2026-03-07T00:30:00" }
];
window.fetch = async (url, opts) => {
  if (url === '/api/health') return { ok: true, json: async () => ({ launcher_found: true }) };
  if (url === '/api/profiles') return { ok: true, json: async () => MOCK_PROFILES };
  if (url === '/api/jobs') return { ok: true, json: async () => MOCK_JOBS };
  if (String(url).match(/\/api\/jobs\/\d+$/)) {
    return { ok: true, json: async () => ({
      id: 3, url: "https://example.com", profile_name: "Default",
      status: "completed", created_at: "2026-03-07T01:00:00",
      started_at: "2026-03-07T01:01:00", completed_at: "2026-03-07T01:15:00",
      error: null,
      log_tail: "INFO  Starting crawl of https://example.com\nINFO  Crawl complete: 1247 URLs processed\nINFO  Exporting: Internal:All\nINFO  Exporting: Response Codes:All\nINFO  Exporting: Redirects:All\nINFO  Zipping output to job_3.zip\nINFO  Done."
    }) };
  }
  return { ok: false, json: async () => ({}) };
};
</script>
`;
const modified = html.replace('</head>', mockScript + '</head>');
fs.writeFileSync('/tmp/ui_render/index_mocked.html', modified);
console.log('Mock HTML written');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  // Screenshot 1: Main view with jobs and profiles loaded
  {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto('file:///tmp/ui_render/index_mocked.html');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: '/tmp/screenshots/01-main-view.png', fullPage: false });
    console.log('Screenshot 1 done');
    await page.close();
  }

  // Screenshot 2: Upload profile radio selected
  {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto('file:///tmp/ui_render/index_mocked.html');
    await page.waitForTimeout(1200);
    await page.click('input[value="upload"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/screenshots/02-upload-profile.png', fullPage: false });
    console.log('Screenshot 2 done');
    await page.close();
  }

  // Screenshot 3: Job detail panel open (full page)
  {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto('file:///tmp/ui_render/index_mocked.html');
    await page.waitForTimeout(1200);
    // Open detail panel by clicking the first View button
    await page.evaluate(function() {
      var panel = document.getElementById('detail-panel');
      panel.style.display = 'block';
      document.getElementById('detail-title').textContent = 'Job #3';
      document.getElementById('detail-grid').innerHTML =
        '<div class="detail-item"><label>Status</label><span><span class="badge badge-completed">completed</span></span></div>' +
        '<div class="detail-item"><label>URL</label><span>https://example.com</span></div>' +
        '<div class="detail-item"><label>Profile</label><span>Default</span></div>' +
        '<div class="detail-item"><label>Created</label><span>3/7/2026, 1:00:00 AM</span></div>' +
        '<div class="detail-item"><label>Started</label><span>3/7/2026, 1:01:00 AM</span></div>' +
        '<div class="detail-item"><label>Completed</label><span>3/7/2026, 1:15:00 AM</span></div>';
      document.getElementById('detail-download').innerHTML =
        '<a href="#" class="btn btn-primary" style="cursor:pointer;">&#8595; Download Results ZIP</a>';
      document.getElementById('log-output').textContent =
        'INFO  Starting crawl of https://example.com\nINFO  Crawl complete: 1247 URLs processed\nINFO  Exporting: Internal:All\nINFO  Exporting: Response Codes:All\nINFO  Exporting: Redirects:All\nINFO  Zipping output to job_3.zip\nINFO  Done.';
    });
    await page.screenshot({ path: '/tmp/screenshots/03-job-detail.png', fullPage: true });
    console.log('Screenshot 3 done');
    await page.close();
  }

  await browser.close();
  console.log('All screenshots done!');
})().catch(function(e) { console.error(e); process.exit(1); });
