'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { makeApp } = require('../helpers/app-factory');

let ctx;

beforeAll(() => {
  ctx = makeApp('jobs-diff');
});

afterAll(() => ctx.cleanup());

// ─── GET /api/jobs/:id/diff ───────────────────────────────────────────────────
describe('GET /api/jobs/:id/diff', () => {
  it('returns 404 for a non-existent job', async () => {
    const res = await ctx.request.get('/api/jobs/99999/diff').expect(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 409 when the job is not completed', async () => {
    const postRes = await ctx.request.post('/api/jobs')
      .send({ url: 'https://diff-queued.example.com' })
      .set('Content-Type', 'application/json')
      .expect(201);

    const res = await ctx.request.get(`/api/jobs/${postRes.body.id}/diff`).expect(409);
    expect(res.body.error).toMatch(/completed/i);
  });

  it('returns 404 when no previous crawl exists for the URL', async () => {
    const { db, DATA_DIR } = require('../../src/db');

    const jobDir = path.join(DATA_DIR, 'jobs', 'diff-no-prev');
    fs.mkdirSync(jobDir, { recursive: true });

    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, output_dir, zip_path)
      VALUES ('https://first-crawl.example.com', 'Internal:All', 'completed', ?, ?)
    `).run(jobDir, path.join(DATA_DIR, 'jobs', 'diff-no-prev.zip'));

    const lastId = db.prepare('SELECT id FROM jobs ORDER BY id DESC LIMIT 1').get().id;

    const res = await ctx.request.get(`/api/jobs/${lastId}/diff`).expect(404);
    expect(res.body.error).toMatch(/first crawl|no diff/i);
  });

  it('returns the diff JSON when diff_summary is stored', async () => {
    const { db, DATA_DIR } = require('../../src/db');

    const diffData = {
      prev_job_id: 1,
      prev_completed_at: '2024-01-01T00:00:00',
      total_added: 3,
      total_removed: 1,
      total_changed: 2,
      files: {},
    };

    const jobDir = path.join(DATA_DIR, 'jobs', 'diff-has-data');
    fs.mkdirSync(jobDir, { recursive: true });

    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, output_dir, zip_path, diff_summary)
      VALUES ('https://diff-data.example.com', 'Internal:All', 'completed', ?, ?, ?)
    `).run(
      jobDir,
      path.join(DATA_DIR, 'jobs', 'diff-has-data.zip'),
      JSON.stringify(diffData),
    );

    const lastId = db.prepare('SELECT id FROM jobs ORDER BY id DESC LIMIT 1').get().id;

    const res = await ctx.request.get(`/api/jobs/${lastId}/diff`).expect(200);
    expect(res.body.prev_job_id).toBe(1);
    expect(res.body.total_added).toBe(3);
    expect(res.body.total_removed).toBe(1);
    expect(res.body.total_changed).toBe(2);
  });

  it('includes diff_summary field in GET /api/jobs/:id response', async () => {
    const { db, DATA_DIR } = require('../../src/db');

    const diffData = { prev_job_id: 99, total_added: 0, total_removed: 0, total_changed: 0, files: {} };
    const jobDir = path.join(DATA_DIR, 'jobs', 'diff-in-detail');
    fs.mkdirSync(jobDir, { recursive: true });

    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, output_dir, zip_path, diff_summary)
      VALUES ('https://detail-diff.example.com', 'Internal:All', 'completed', ?, ?, ?)
    `).run(
      jobDir,
      path.join(DATA_DIR, 'jobs', 'diff-in-detail.zip'),
      JSON.stringify(diffData),
    );

    const lastId = db.prepare('SELECT id FROM jobs ORDER BY id DESC LIMIT 1').get().id;
    const res = await ctx.request.get(`/api/jobs/${lastId}`).expect(200);
    expect(res.body).toHaveProperty('diff_summary');
    const parsed = JSON.parse(res.body.diff_summary);
    expect(parsed.prev_job_id).toBe(99);
  });
});
