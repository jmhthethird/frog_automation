'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { makeApp } = require('../helpers/app-factory');

let ctx;
let dataDir;

beforeAll(() => {
  ctx = makeApp('jobs');
  dataDir = ctx.dataDir;
});

afterAll(() => ctx.cleanup());

// ─── GET /api/jobs ────────────────────────────────────────────────────────────
describe('GET /api/jobs', () => {
  it('returns a paginated response object when no jobs exist', async () => {
    const res = await ctx.request.get('/api/jobs').expect(200);
    expect(res.body).toMatchObject({ jobs: [], total: 0, page: 1, totalPages: 1 });
    expect(Array.isArray(res.body.jobs)).toBe(true);
  });

  it('returns a list of jobs after one is created', async () => {
    await ctx.request.post('/api/jobs')
      .send({ url: 'https://example.com' })
      .set('Content-Type', 'application/json');

    const res = await ctx.request.get('/api/jobs').expect(200);
    expect(res.body.jobs.length).toBeGreaterThan(0);
    expect(res.body.jobs[0]).toMatchObject({ url: 'https://example.com' });
  });

  it('includes profile_name field (null when no profile)', async () => {
    const res = await ctx.request.get('/api/jobs').expect(200);
    expect(res.body.jobs[0]).toHaveProperty('profile_name');
  });

  it('respects page and limit query params', async () => {
    // Seed several more jobs directly to avoid triggering rate limiter
    const { db } = getDb();
    for (let i = 0; i < 5; i++) {
      db.prepare(`INSERT INTO jobs (url, export_tabs, status) VALUES (?, 'Internal:All', 'queued')`)
        .run(`https://page-test-${i}.example.com`);
    }

    const res = await ctx.request.get('/api/jobs?page=1&limit=2').expect(200);
    expect(res.body.jobs).toHaveLength(2);
    expect(res.body.page).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('returns page 2 when requested', async () => {
    // Ensure at least 3 jobs exist for page 2 with limit=2
    const { db } = getDb();
    const count = db.prepare('SELECT COUNT(*) AS cnt FROM jobs').get().cnt;
    if (count < 3) {
      db.prepare(`INSERT INTO jobs (url, export_tabs, status) VALUES ('https://page2-extra.example.com', 'Internal:All', 'queued')`)
        .run();
    }

    const res = await ctx.request.get('/api/jobs?page=2&limit=2').expect(200);
    expect(res.body.page).toBe(2);
    expect(res.body.jobs.length).toBeGreaterThan(0);
  });

  it('clamps page to totalPages when page exceeds total', async () => {
    const res = await ctx.request.get('/api/jobs?page=9999&limit=10').expect(200);
    expect(res.body.page).toBeLessThanOrEqual(res.body.totalPages);
  });
});

// ─── GET /api/jobs/:id ────────────────────────────────────────────────────────
describe('GET /api/jobs/:id', () => {
  let jobId;

  beforeAll(async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://detail-test.example.com' })
      .set('Content-Type', 'application/json');
    jobId = res.body.id;
  });

  it('returns 404 for a non-existent job', async () => {
    const res = await ctx.request.get('/api/jobs/99999').expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('returns the job for a valid id', async () => {
    const res = await ctx.request.get(`/api/jobs/${jobId}`).expect(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body.url).toBe('https://detail-test.example.com');
  });

  it('does not include a log_tail field in job detail response', async () => {
    const res = await ctx.request.get(`/api/jobs/${jobId}`).expect(200);
    expect(res.body).not.toHaveProperty('log_tail');
  });

  it('does not include duration_seconds when job has no started_at or completed_at', async () => {
    const { db } = getDb();
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status)
      VALUES ('https://no-duration.example.com', 'Internal:All', 'queued')
    `).run();
    const id = db.prepare("SELECT id FROM jobs ORDER BY id DESC LIMIT 1").get().id;

    const res = await ctx.request.get(`/api/jobs/${id}`).expect(200);
    expect(res.body.duration_seconds).toBeUndefined();
  });

  it('includes duration_seconds when both started_at and completed_at are set', async () => {
    const { db } = getDb();
    // Simulate a completed job with known timestamps (30-second run)
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, started_at, completed_at)
      VALUES ('https://duration-test.example.com', 'Internal:All', 'completed',
              datetime('now', '-30 seconds'), datetime('now'))
    `).run();
    const id = db.prepare("SELECT id FROM jobs ORDER BY id DESC LIMIT 1").get().id;

    const res = await ctx.request.get(`/api/jobs/${id}`).expect(200);
    expect(res.body.duration_seconds).toBeGreaterThanOrEqual(29);
    expect(res.body.duration_seconds).toBeLessThanOrEqual(31);
  });

  it('includes prev_duration_seconds when a previous completed crawl exists for the same URL', async () => {
    const { db } = getDb();
    const url = 'https://prev-duration-test.example.com';

    // Insert an older completed crawl (45-second run)
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, started_at, completed_at)
      VALUES (?, 'Internal:All', 'completed',
              datetime('now', '-120 seconds'), datetime('now', '-75 seconds'))
    `).run(url);

    // Insert the current (newer) completed crawl
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, started_at, completed_at)
      VALUES (?, 'Internal:All', 'completed',
              datetime('now', '-30 seconds'), datetime('now'))
    `).run(url);
    const id = db.prepare("SELECT id FROM jobs ORDER BY id DESC LIMIT 1").get().id;

    const res = await ctx.request.get(`/api/jobs/${id}`).expect(200);
    expect(res.body.prev_duration_seconds).toBeGreaterThanOrEqual(44);
    expect(res.body.prev_duration_seconds).toBeLessThanOrEqual(46);
    expect(res.body.prev_completed_at).toBeTruthy();
  });

  it('does not include prev_duration_seconds when no previous crawl exists for the URL', async () => {
    const { db } = getDb();
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status)
      VALUES ('https://no-prev-crawl.example.com', 'Internal:All', 'queued')
    `).run();
    const id = db.prepare("SELECT id FROM jobs ORDER BY id DESC LIMIT 1").get().id;

    const res = await ctx.request.get(`/api/jobs/${id}`).expect(200);
    expect(res.body.prev_duration_seconds).toBeUndefined();
    expect(res.body.prev_completed_at).toBeUndefined();
  });
});

// ─── GET /api/jobs/:id/log ────────────────────────────────────────────────────
describe('GET /api/jobs/:id/log', () => {
  let logJobId;
  let cronJobId;

  beforeAll(async () => {
    // Regular queued job for the streaming test
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://log-stream-test.example.com' })
      .set('Content-Type', 'application/json');
    logJobId = res.body.id;

    // Cron job – stays in 'scheduled' state so the crawler never starts
    // and no crawler.log is created, letting us reliably test the 404 case.
    const cronRes = await ctx.request.post('/api/jobs')
      .send({ url: 'https://log-cron-test.example.com', cron_expression: '0 3 * * *' })
      .set('Content-Type', 'application/json');
    cronJobId = cronRes.body.id;
  });

  it('returns 404 when the log file does not exist yet', async () => {
    const res = await ctx.request.get(`/api/jobs/${cronJobId}/log`).expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 404 for a non-existent job', async () => {
    const res = await ctx.request.get('/api/jobs/99999/log').expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('streams the full log file as plain text', async () => {
    const jobRes = await ctx.request.get(`/api/jobs/${logJobId}`).expect(200);
    const outputDir = jobRes.body.output_dir;
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });
      const logContent = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`).join('\n');
      fs.writeFileSync(path.join(outputDir, 'crawler.log'), logContent, 'utf8');
      const res = await ctx.request.get(`/api/jobs/${logJobId}/log`).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('line 1');
      expect(res.text).toContain('line 150');
    }
  });
});

// ─── POST /api/jobs ───────────────────────────────────────────────────────────
describe('POST /api/jobs', () => {
  it('returns 400 when url is missing', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({})
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(res.body.error).toMatch(/url/i);
  });

  it('returns 400 when url is an empty string', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: '' })
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when url is not a valid URL', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'not-a-url' })
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns 400 when url uses a non-http/https scheme', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'ftp://example.com' })
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(res.body.error).toMatch(/http/i);
  });

  it('returns 400 when profile_id references a non-existent profile', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://example.com', profile_id: 9999 })
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(res.body.error).toMatch(/profile/i);
  });

  it('creates a job with status "queued" for a valid URL', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://valid.example.com' })
      .set('Content-Type', 'application/json')
      .expect(201);

    expect(res.body).toMatchObject({
      url: 'https://valid.example.com',
      status: 'queued',
      id: expect.any(Number),
    });
  });

  it('uses default export tabs when none are provided', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://defaults.example.com' })
      .set('Content-Type', 'application/json')
      .expect(201);

    const exportTabs = res.body.export_tabs.split(',');
    expect(exportTabs.length).toBeGreaterThan(0);
    expect(exportTabs).toEqual(expect.arrayContaining([
      'AMP:All',
      'Analytics:All',
      'Internal:All',
      'Response Codes:All',
      'URL:All',
      // individual tab entries
      'AMP:Non-200 Response',
      'Internal:HTML',
      'Response Codes:Success (2xx)',
      'URL:Underscores',
      'H1:Missing',
    ]));
    // all 314 entries (29 :All flags + 285 individual items)
    expect(exportTabs).toHaveLength(314);
  });

  it('uses custom export tabs when provided', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://custom.example.com', export_tabs: 'Internal:All,Response Codes:All' })
      .set('Content-Type', 'application/json')
      .expect(201);

    expect(res.body.export_tabs).toBe('Internal:All,Response Codes:All');
  });

  it('creates a job with a valid profile_id', async () => {
    // First upload a profile.
    const profileContent = Buffer.from('<config/>');
    const profRes = await ctx.request.post('/api/profiles')
      .attach('profile', profileContent, { filename: 'test.seospiderconfig', contentType: 'application/octet-stream' })
      .expect(201);
    const profileId = profRes.body.id;

    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://profile.example.com', profile_id: profileId })
      .set('Content-Type', 'application/json')
      .expect(201);

    expect(res.body.profile_id).toBe(profileId);
  });

  it('sets output_dir to a path under DATA_DIR', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://outdir.example.com' })
      .set('Content-Type', 'application/json')
      .expect(201);

    expect(res.body.output_dir).toContain(dataDir);
  });

  it('returns 400 when cron_expression is invalid', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://cron.example.com', cron_expression: 'not-a-cron' })
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(res.body.error).toMatch(/cron/i);
  });

  it('creates a scheduled job when a valid cron_expression is provided', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://cron.example.com', cron_expression: '0 * * * *' })
      .set('Content-Type', 'application/json')
      .expect(201);

    expect(res.body).toMatchObject({
      url: 'https://cron.example.com',
      status: 'scheduled',
      cron_expression: '0 * * * *',
      id: expect.any(Number),
    });
    expect(res.body.next_run_at).toBeTruthy();
    expect(new Date(res.body.next_run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not immediately queue a scheduled cron job', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://cron-delayed.example.com', cron_expression: '0 0 1 1 *' })
      .set('Content-Type', 'application/json')
      .expect(201);

    // Job must stay in 'scheduled' state – not pushed to the queue.
    const detail = await ctx.request.get(`/api/jobs/${res.body.id}`).expect(200);
    expect(detail.body.status).toBe('scheduled');
  });

  it('treats an empty string cron_expression as no cron (queued immediately)', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://no-cron.example.com', cron_expression: '' })
      .set('Content-Type', 'application/json')
      .expect(201);

    expect(res.body.status).toBe('queued');
    expect(res.body.cron_expression).toBeFalsy();
  });
});

// ─── GET /api/jobs/:id/download ───────────────────────────────────────────────
describe('GET /api/jobs/:id/download', () => {
  it('returns 404 for a non-existent job', async () => {
    await ctx.request.get('/api/jobs/99999/download').expect(404);
  });

  it('returns 409 when the job is not yet completed', async () => {
    const postRes = await ctx.request.post('/api/jobs')
      .send({ url: 'https://download-test.example.com' })
      .set('Content-Type', 'application/json')
      .expect(201);

    await ctx.request.get(`/api/jobs/${postRes.body.id}/download`).expect(409);
  });

  it('serves the ZIP file when the job is completed', async () => {
    // Manually set a completed job with a real ZIP file.
    const { db, DATA_DIR } = getDb();
    const jobDir = path.join(DATA_DIR, 'jobs', 'completed-test');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'crawler.log'), 'done\n');

    // Create a real ZIP using archiver.
    const zipPath = `${jobDir}.zip`;
    await createZip(jobDir, zipPath);

    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, output_dir, zip_path)
      VALUES ('https://zip.example.com', 'Internal:All', 'completed', ?, ?)
    `).run(jobDir, zipPath);

    const lastId = db.prepare("SELECT id FROM jobs ORDER BY id DESC LIMIT 1").get().id;

    const res = await ctx.request.get(`/api/jobs/${lastId}/download`).expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/i);
    // Filename format: {domain}_{YYYY-MM-DD}_{HH-MM[AM|PM]}-job{id}.zip
    // Domain from "zip.example.com" → "example"
    expect(res.headers['content-disposition']).toMatch(/example_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}[AP]M-job\d+\.zip/);
  });
});

// ─── POST /api/jobs/:id/stop ──────────────────────────────────────────────────
describe('POST /api/jobs/:id/stop', () => {
  it('returns 404 for a non-existent job', async () => {
    const res = await ctx.request.post('/api/jobs/99999/stop').expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 409 when the job is not running (queued)', async () => {
    const postRes = await ctx.request.post('/api/jobs')
      .send({ url: 'https://stop-queued.example.com' })
      .set('Content-Type', 'application/json')
      .expect(201);

    const res = await ctx.request.post(`/api/jobs/${postRes.body.id}/stop`).expect(409);
    expect(res.body.error).toMatch(/not running/i);
  });

  it('returns 409 when the job is completed', async () => {
    const { db } = getDb();
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, completed_at)
      VALUES ('https://stop-completed.example.com', 'Internal:All', 'completed', datetime('now'))
    `).run();
    const id = db.prepare("SELECT id FROM jobs ORDER BY id DESC LIMIT 1").get().id;

    const res = await ctx.request.post(`/api/jobs/${id}/stop`).expect(409);
    expect(res.body.error).toMatch(/not running/i);
  });

  it('returns 409 when job is marked running but has no active process', async () => {
    const { db } = getDb();
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, started_at)
      VALUES ('https://stop-running-no-proc.example.com', 'Internal:All', 'running', datetime('now'))
    `).run();
    const id = db.prepare("SELECT id FROM jobs ORDER BY id DESC LIMIT 1").get().id;

    const res = await ctx.request.post(`/api/jobs/${id}/stop`).expect(409);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ─── POST /api/jobs/:id/rerun ─────────────────────────────────────────────────
describe('POST /api/jobs/:id/rerun', () => {
  it('returns 404 for a non-existent job', async () => {
    const res = await ctx.request.post('/api/jobs/99999/rerun').expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('creates a new queued job with the same URL and settings', async () => {
    const { db } = getDb();
    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, completed_at)
      VALUES ('https://rerun.example.com', 'Internal:All,Response Codes:All', 'stopped', datetime('now'))
    `).run();
    const originalId = db.prepare("SELECT id FROM jobs ORDER BY id DESC LIMIT 1").get().id;

    const res = await ctx.request.post(`/api/jobs/${originalId}/rerun`).expect(201);
    expect(res.body).toMatchObject({
      url: 'https://rerun.example.com',
      export_tabs: 'Internal:All,Response Codes:All',
      status: 'queued',
      id: expect.any(Number),
    });
    expect(res.body.id).not.toBe(originalId);
  });

  it('sets output_dir for the new job', async () => {
    const postRes = await ctx.request.post('/api/jobs')
      .send({ url: 'https://rerun-outdir.example.com' })
      .set('Content-Type', 'application/json')
      .expect(201);

    const res = await ctx.request.post(`/api/jobs/${postRes.body.id}/rerun`).expect(201);
    expect(res.body.output_dir).toContain(dataDir);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Access the db module that was loaded into the current app context. */
function getDb() {
  // After resetModules the db is isolated per test suite.
  // We reach it by requiring from the module registry.
  return require('../../src/db');
}

/** Build a minimal ZIP from a directory (used to set up "completed" jobs). */
function createZip(srcDir, destZip) {
  const archiver = require('archiver');
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver('zip');
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(srcDir, path.basename(srcDir));
    archive.finalize();
  });
}
