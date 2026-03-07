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
  it('returns an empty array when no jobs exist', async () => {
    const res = await ctx.request.get('/api/jobs').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('returns a list of jobs after one is created', async () => {
    await ctx.request.post('/api/jobs')
      .send({ url: 'https://example.com' })
      .set('Content-Type', 'application/json');

    const res = await ctx.request.get('/api/jobs').expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({ url: 'https://example.com' });
  });

  it('includes profile_name field (null when no profile)', async () => {
    const res = await ctx.request.get('/api/jobs').expect(200);
    expect(res.body[0]).toHaveProperty('profile_name');
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

  it('includes a log_tail field (null when log file does not exist yet)', async () => {
    const res = await ctx.request.get(`/api/jobs/${jobId}`).expect(200);
    // The job was just queued; the output_dir exists but log file may not.
    expect(res.body).toHaveProperty('log_tail');
  });

  it('returns log_tail content when the log file exists', async () => {
    // Manually create a log file in the job's output directory.
    const jobRes = await ctx.request.get(`/api/jobs/${jobId}`).expect(200);
    const outputDir = jobRes.body.output_dir;
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'crawler.log'), 'line1\nline2\n');
      const res2 = await ctx.request.get(`/api/jobs/${jobId}`).expect(200);
      expect(res2.body.log_tail).toContain('line1');
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

    expect(res.body.export_tabs).toContain('Internal:All');
  });

  it('uses custom export tabs when provided', async () => {
    const res = await ctx.request.post('/api/jobs')
      .send({ url: 'https://custom.example.com', export_tabs: 'Redirect Chains:All' })
      .set('Content-Type', 'application/json')
      .expect(201);

    expect(res.body.export_tabs).toBe('Redirect Chains:All');
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
