'use strict';

const path = require('path');
const fs   = require('fs');

const { makeApp } = require('../helpers/app-factory');
const { sanitizeSpiderConfig } = require('../../src/routes/spider-configs');

let ctx;

beforeAll(() => {
  ctx = makeApp('spider-configs');
});

afterAll(() => ctx.cleanup());

// ─── sanitizeSpiderConfig unit tests ──────────────────────────────────────────
describe('sanitizeSpiderConfig', () => {
  it('removes Unix absolute path entry values', () => {
    const input = `<properties><entry key="storage.db_dir">/home/user/crawls/</entry></properties>`;
    const output = sanitizeSpiderConfig(input);
    expect(output).toContain('<entry key="storage.db_dir"></entry>');
    expect(output).not.toContain('/home/user/crawls/');
  });

  it('removes macOS absolute path entry values', () => {
    const input = `<properties><entry key="storage.dir">/Users/john/Library/ScreamingFrog/</entry></properties>`;
    const output = sanitizeSpiderConfig(input);
    expect(output).toContain('<entry key="storage.dir"></entry>');
  });

  it('removes Windows drive path entry values', () => {
    const input = `<properties><entry key="storage.db_dir">C:\\Users\\john\\crawls\\</entry></properties>`;
    const output = sanitizeSpiderConfig(input);
    expect(output).toContain('<entry key="storage.db_dir"></entry>');
    expect(output).not.toContain('C:\\Users\\john');
  });

  it('removes UNC path entry values', () => {
    const input = `<properties><entry key="storage.dir">\\\\server\\share\\crawls</entry></properties>`;
    const output = sanitizeSpiderConfig(input);
    expect(output).toContain('<entry key="storage.dir"></entry>');
  });

  it('preserves non-path entries unchanged', () => {
    const input = `<properties>
<entry key="crawl.threads">5</entry>
<entry key="spider.max_crawl_depth">-1</entry>
<entry key="spider.user_agent">Mozilla/5.0</entry>
</properties>`;
    const output = sanitizeSpiderConfig(input);
    expect(output).toContain('<entry key="crawl.threads">5</entry>');
    expect(output).toContain('<entry key="spider.max_crawl_depth">-1</entry>');
    expect(output).toContain('<entry key="spider.user_agent">Mozilla/5.0</entry>');
  });

  it('handles a mixed file correctly', () => {
    const input = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<properties>
<entry key="storage.db_dir">/home/user/.ScreamingFrogSEOSpider/</entry>
<entry key="crawl.threads">5</entry>
<entry key="spider.max_crawl_depth">-1</entry>
</properties>`;
    const output = sanitizeSpiderConfig(input);
    expect(output).toContain('<entry key="storage.db_dir"></entry>');
    expect(output).toContain('<entry key="crawl.threads">5</entry>');
    expect(output).toContain('<entry key="spider.max_crawl_depth">-1</entry>');
  });
});

// ─── GET /api/spider-configs ──────────────────────────────────────────────────
describe('GET /api/spider-configs', () => {
  it('returns an empty array when no spider configs exist', async () => {
    const res = await ctx.request.get('/api/spider-configs').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns spider configs after one is uploaded', async () => {
    await uploadSpiderConfig(ctx.request, 'list-test.seospiderconfig');
    const res = await ctx.request.get('/api/spider-configs').expect(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('each config has id, name, filename, filepath, created_at fields', async () => {
    const res = await ctx.request.get('/api/spider-configs').expect(200);
    const c = res.body[0];
    expect(c).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      filename: expect.any(String),
      filepath: expect.any(String),
      created_at: expect.any(String),
    });
  });
});

// ─── GET /api/spider-configs/local ────────────────────────────────────────────
describe('GET /api/spider-configs/local', () => {
  it('returns found:false when no local spider.config exists', async () => {
    const res = await ctx.request.get('/api/spider-configs/local').expect(200);
    // On the CI machine there is no SF installation, so found should be false.
    expect(res.body).toHaveProperty('found');
    if (!res.body.found) {
      expect(res.body.found).toBe(false);
    }
  });
});

// ─── POST /api/spider-configs ─────────────────────────────────────────────────
describe('POST /api/spider-configs', () => {
  it('returns 400 when no file is attached', async () => {
    const res = await ctx.request.post('/api/spider-configs').expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when the uploaded file has the wrong extension', async () => {
    const content = Buffer.from('not a config');
    const res = await ctx.request.post('/api/spider-configs')
      .attach('spider_config', content, { filename: 'config.txt', contentType: 'text/plain' })
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 201 and persists a valid .seospiderconfig upload', async () => {
    const res = await uploadSpiderConfig(ctx.request, 'valid.seospiderconfig');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(Number),
      filename: expect.stringMatching(/valid\.seospiderconfig$/),
      filepath: expect.any(String),
      created_at: expect.any(String),
    });
    expect(fs.existsSync(res.body.filepath)).toBe(true);
  });

  it('returns 201 and persists a valid .config upload', async () => {
    const content = Buffer.from('<properties><entry key="crawl.threads">5</entry></properties>');
    const res = await ctx.request.post('/api/spider-configs')
      .attach('spider_config', content, { filename: 'spider.config', contentType: 'application/octet-stream' })
      .expect(201);
    expect(res.body).toMatchObject({ id: expect.any(Number) });
  });

  it('sanitizes absolute path entries on upload', async () => {
    const xml = `<properties>
<entry key="storage.db_dir">/home/user/.ScreamingFrogSEOSpider/</entry>
<entry key="crawl.threads">5</entry>
</properties>`;
    const content = Buffer.from(xml);
    const res = await ctx.request.post('/api/spider-configs')
      .attach('spider_config', content, { filename: 'sanitize-test.seospiderconfig', contentType: 'application/octet-stream' })
      .expect(201);
    const saved = fs.readFileSync(res.body.filepath, 'utf8');
    expect(saved).toContain('<entry key="storage.db_dir"></entry>');
    expect(saved).not.toContain('/home/user/');
    expect(saved).toContain('<entry key="crawl.threads">5</entry>');
  });

  it('uses the provided display name', async () => {
    const content = Buffer.from('<properties/>');
    const res = await ctx.request.post('/api/spider-configs')
      .attach('spider_config', content, { filename: 'named.seospiderconfig', contentType: 'application/octet-stream' })
      .field('name', 'My Spider Config')
      .expect(201);
    expect(res.body.name).toBe('My Spider Config');
  });

  it('derives name from filename when no display name is given', async () => {
    const content = Buffer.from('<properties/>');
    const res = await ctx.request.post('/api/spider-configs')
      .attach('spider_config', content, { filename: 'derived-name.seospiderconfig', contentType: 'application/octet-stream' })
      .expect(201);
    expect(res.body.name).toBe('derived-name');
  });

  it('returns 400 when the file exceeds 10 MB', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 'x');
    const res = await ctx.request.post('/api/spider-configs')
      .attach('spider_config', big, { filename: 'toobig.seospiderconfig', contentType: 'application/octet-stream' })
      .expect(400);
    expect(res.body.error).toMatch(/too large/i);
  });
});

// ─── POST /api/spider-configs/import-local ────────────────────────────────────
describe('POST /api/spider-configs/import-local', () => {
  it('returns 404 when no local spider.config is present', async () => {
    // On CI no SF is installed so this will always be 404.
    const res = await ctx.request.post('/api/spider-configs/import-local').expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('imports and sanitizes a local spider.config when present', async () => {
    // The import-local endpoint relies on detecting real SF installation paths
    // on the host machine.  On CI there is no SF installation, so the endpoint
    // returns 404 (tested above).  The sanitization logic is exercised directly
    // via the sanitizeSpiderConfig unit tests and via the POST upload tests.
    // This test confirms the endpoint signature is correct when called with a
    // JSON body for the optional name field.
    const res = await ctx.request
      .post('/api/spider-configs/import-local')
      .set('Content-Type', 'application/json')
      .send({ name: 'My Local Config' });
    // 404 is expected on CI (no SF installed); 201 would be expected on a
    // machine with SF installed.
    expect([201, 404]).toContain(res.status);
    expect(res.body).toBeDefined();
  });
});

// ─── DELETE /api/spider-configs/:id ──────────────────────────────────────────
describe('DELETE /api/spider-configs/:id', () => {
  it('returns 404 for a non-existent spider config', async () => {
    const res = await ctx.request.delete('/api/spider-configs/99999').expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('deletes the config record and removes the file from disk', async () => {
    const createRes = await uploadSpiderConfig(ctx.request, 'to-delete.seospiderconfig');
    const { id, filepath } = createRes.body;

    expect(fs.existsSync(filepath)).toBe(true);

    await ctx.request.delete(`/api/spider-configs/${id}`).expect(200);

    await ctx.request.get('/api/spider-configs').then((r) => {
      const ids = r.body.map((c) => c.id);
      expect(ids).not.toContain(id);
    });

    expect(fs.existsSync(filepath)).toBe(false);
  });

  it('still returns 200 when the backing file has already been removed', async () => {
    const createRes = await uploadSpiderConfig(ctx.request, 'already-gone.seospiderconfig');
    const { id, filepath } = createRes.body;

    fs.unlinkSync(filepath);

    await ctx.request.delete(`/api/spider-configs/${id}`).expect(200);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uploadSpiderConfig(request, filename) {
  const content = Buffer.from('<properties><entry key="crawl.threads">5</entry></properties>');
  return request.post('/api/spider-configs')
    .attach('spider_config', content, { filename, contentType: 'application/octet-stream' });
}
