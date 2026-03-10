'use strict';

const fs   = require('fs');
const path = require('path');

const { makeApp } = require('../helpers/app-factory');

let ctx;

beforeAll(() => {
  ctx = makeApp('jobs-compare');
});

afterAll(() => ctx.cleanup());

// ─── GET /api/jobs/:id/compare ────────────────────────────────────────────────
describe('GET /api/jobs/:id/compare', () => {
  it('returns 404 for a non-existent job', async () => {
    const res = await ctx.request.get('/api/jobs/99999/compare').expect(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 409 when the job is not completed', async () => {
    const postRes = await ctx.request.post('/api/jobs')
      .send({ url: 'https://compare-queued.example.com' })
      .set('Content-Type', 'application/json')
      .expect(201);

    const res = await ctx.request.get(`/api/jobs/${postRes.body.id}/compare`).expect(409);
    expect(res.body.error).toMatch(/completed/i);
  });

  it('returns 404 when no compare directory exists', async () => {
    const { db, DATA_DIR } = require('../../src/db');

    const jobDir = path.join(DATA_DIR, 'jobs', 'compare-no-dir');
    fs.mkdirSync(jobDir, { recursive: true });

    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, output_dir, zip_path)
      VALUES ('https://compare-first.example.com', 'Internal:All', 'completed', ?, ?)
    `).run(jobDir, path.join(DATA_DIR, 'jobs', 'compare-no-dir.zip'));

    const lastId = db.prepare('SELECT id FROM jobs ORDER BY id DESC LIMIT 1').get().id;

    const res = await ctx.request.get(`/api/jobs/${lastId}/compare`).expect(404);
    expect(res.body.error).toMatch(/no compare output/i);
  });

  it('returns 404 when compare directory exists but has no CSV files', async () => {
    const { db, DATA_DIR } = require('../../src/db');

    const jobDir = path.join(DATA_DIR, 'jobs', 'compare-empty-dir');
    const compareDir = path.join(jobDir, 'compare');
    fs.mkdirSync(compareDir, { recursive: true });

    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, output_dir, zip_path)
      VALUES ('https://compare-empty.example.com', 'Internal:All', 'completed', ?, ?)
    `).run(jobDir, path.join(DATA_DIR, 'jobs', 'compare-empty-dir.zip'));

    const lastId = db.prepare('SELECT id FROM jobs ORDER BY id DESC LIMIT 1').get().id;

    const res = await ctx.request.get(`/api/jobs/${lastId}/compare`).expect(404);
    expect(res.body.error).toMatch(/no compare output/i);
  });

  it('returns compare data when compare CSV files exist', async () => {
    const { db, DATA_DIR } = require('../../src/db');

    const jobDir = path.join(DATA_DIR, 'jobs', 'compare-has-data');
    const compareDir = path.join(jobDir, 'compare');
    fs.mkdirSync(compareDir, { recursive: true });

    const csvContent = 'Address,Status Code,Crawl 1 Status Code,Crawl 2 Status Code\nhttps://example.com/page,200,200,301\nhttps://example.com/new,201,,201\n';
    fs.writeFileSync(path.join(compareDir, 'compare_internal.csv'), csvContent);

    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, output_dir, zip_path)
      VALUES ('https://compare-data.example.com', 'Internal:All', 'completed', ?, ?)
    `).run(jobDir, path.join(DATA_DIR, 'jobs', 'compare-has-data.zip'));

    const lastId = db.prepare('SELECT id FROM jobs ORDER BY id DESC LIMIT 1').get().id;

    const res = await ctx.request.get(`/api/jobs/${lastId}/compare`).expect(200);
    expect(res.body).toHaveProperty('files');
    expect(res.body.files).toHaveProperty(['compare_internal.csv']);
    expect(Array.isArray(res.body.files['compare_internal.csv'])).toBe(true);
    expect(res.body.files['compare_internal.csv'].length).toBe(2);
    expect(res.body.files['compare_internal.csv'][0]['Address']).toBe('https://example.com/page');
  });
});

// ─── GET /api/jobs/:id/compare/download ──────────────────────────────────────
describe('GET /api/jobs/:id/compare/download', () => {
  it('returns 404 for a non-existent job', async () => {
    const res = await ctx.request.get('/api/jobs/99999/compare/download').expect(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 409 when the job is not completed', async () => {
    const postRes = await ctx.request.post('/api/jobs')
      .send({ url: 'https://compare-dl-queued.example.com' })
      .set('Content-Type', 'application/json')
      .expect(201);

    const res = await ctx.request.get(`/api/jobs/${postRes.body.id}/compare/download`).expect(409);
    expect(res.body.error).toMatch(/completed/i);
  });

  it('returns 404 when no compare directory exists', async () => {
    const { db, DATA_DIR } = require('../../src/db');

    const jobDir = path.join(DATA_DIR, 'jobs', 'compare-dl-no-dir');
    fs.mkdirSync(jobDir, { recursive: true });

    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, output_dir, zip_path)
      VALUES ('https://compare-dl-first.example.com', 'Internal:All', 'completed', ?, ?)
    `).run(jobDir, path.join(DATA_DIR, 'jobs', 'compare-dl-no-dir.zip'));

    const lastId = db.prepare('SELECT id FROM jobs ORDER BY id DESC LIMIT 1').get().id;

    const res = await ctx.request.get(`/api/jobs/${lastId}/compare/download`).expect(404);
    expect(res.body.error).toMatch(/no compare output/i);
  });

  it('returns a zip archive when compare directory exists', async () => {
    const { db, DATA_DIR } = require('../../src/db');

    const jobDir = path.join(DATA_DIR, 'jobs', 'compare-dl-has-data');
    const compareDir = path.join(jobDir, 'compare');
    fs.mkdirSync(compareDir, { recursive: true });

    fs.writeFileSync(
      path.join(compareDir, 'compare_internal.csv'),
      'Address,Status Code\nhttps://example.com/page,200\n'
    );

    db.prepare(`
      INSERT INTO jobs (url, export_tabs, status, output_dir, zip_path)
      VALUES ('https://compare-dl-data.example.com', 'Internal:All', 'completed', ?, ?)
    `).run(jobDir, path.join(DATA_DIR, 'jobs', 'compare-dl-has-data.zip'));

    const lastId = db.prepare('SELECT id FROM jobs ORDER BY id DESC LIMIT 1').get().id;

    const res = await ctx.request.get(`/api/jobs/${lastId}/compare/download`).expect(200);
    expect(res.headers['content-type']).toMatch(/zip/i);
    // Filename format: {domain}_{YYYY-MM-DD}_{HH-MM[AM|PM]}-job{id}-compare.zip
    // Domain from "compare-dl-data.example.com" → "example"
    expect(res.headers['content-disposition']).toMatch(/attachment/i);
    expect(res.headers['content-disposition']).toMatch(/example_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}[AP]M-job\d+-compare\.zip/);
    expect(Buffer.isBuffer(res.body) || res.body).toBeTruthy();
  });
});
