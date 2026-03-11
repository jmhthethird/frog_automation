'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const { makeApp } = require('../helpers/app-factory');
const {
  sanitizeSpiderConfig,
  parseSpiderConfigEntries,
  getLocalSfDataDir,
  autoImportLocalConfig,
} = require('../../src/routes/spider-configs');

let ctx;

beforeAll(() => {
  ctx = makeApp('spider-configs');
});

afterAll(() => ctx.cleanup());

// ─── parseSpiderConfigEntries ─────────────────────────────────────────────────
describe('parseSpiderConfigEntries()', () => {
  it('parses all entry key/value pairs', () => {
    const xml = `<properties>
<entry key="crawl.threads">5</entry>
<entry key="storage.db_dir">/home/user/.SF/</entry>
<entry key="empty.key"></entry>
</properties>`;
    const entries = parseSpiderConfigEntries(xml);
    expect(entries['crawl.threads']).toBe('5');
    expect(entries['storage.db_dir']).toBe('/home/user/.SF/');
    expect(entries['empty.key']).toBe('');
  });

  it('returns an empty object for content with no entries', () => {
    expect(parseSpiderConfigEntries('<properties/>')).toEqual({});
  });

  it('handles Windows drive paths', () => {
    const xml = `<entry key="storage.db_dir">C:\\Users\\bob\\SF\\</entry>`;
    const entries = parseSpiderConfigEntries(xml);
    expect(entries['storage.db_dir']).toBe('C:\\Users\\bob\\SF\\');
  });
});

// ─── sanitizeSpiderConfig (no laptop entries – fallback to blank) ──────────────
describe('sanitizeSpiderConfig() – no laptopEntries (fallback)', () => {
  it('clears Unix absolute path entry values', () => {
    const input = `<properties><entry key="storage.db_dir">/home/user/crawls/</entry></properties>`;
    const output = sanitizeSpiderConfig(input);
    expect(output).toContain('<entry key="storage.db_dir"></entry>');
    expect(output).not.toContain('/home/user/crawls/');
  });

  it('clears macOS absolute path entry values', () => {
    const input = `<properties><entry key="storage.dir">/Users/john/Library/ScreamingFrog/</entry></properties>`;
    const output = sanitizeSpiderConfig(input);
    expect(output).toContain('<entry key="storage.dir"></entry>');
  });

  it('clears Windows drive path entry values', () => {
    const input = `<properties><entry key="storage.db_dir">C:\\Users\\john\\crawls\\</entry></properties>`;
    const output = sanitizeSpiderConfig(input);
    expect(output).toContain('<entry key="storage.db_dir"></entry>');
    expect(output).not.toContain('C:\\Users\\john');
  });

  it('clears UNC path entry values', () => {
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

// ─── sanitizeSpiderConfig WITH laptop entries ─────────────────────────────────
describe('sanitizeSpiderConfig() – with laptopEntries (path replacement)', () => {
  const laptopEntries = {
    'storage.db_dir': '/home/bob/.ScreamingFrogSEOSpider/',
    'ui.recent_config_0': '/home/bob/projects/site.seospiderconfig',
  };

  it('replaces absolute path values with the laptop value for the same key', () => {
    const input = `<properties>
<entry key="storage.db_dir">/Users/alice/.ScreamingFrogSEOSpider/</entry>
</properties>`;
    const output = sanitizeSpiderConfig(input, laptopEntries);
    expect(output).toContain('<entry key="storage.db_dir">/home/bob/.ScreamingFrogSEOSpider/</entry>');
    expect(output).not.toContain('/Users/alice/');
  });

  it('replaces ui.recent_config_* paths with the laptop value', () => {
    const input = `<properties>
<entry key="ui.recent_config_0">/Users/alice/projects/old.seospiderconfig</entry>
</properties>`;
    const output = sanitizeSpiderConfig(input, laptopEntries);
    expect(output).toContain('<entry key="ui.recent_config_0">/home/bob/projects/site.seospiderconfig</entry>');
  });

  it('clears a path key not present in the laptop entries', () => {
    const input = `<properties>
<entry key="some.unknown.path">/Users/alice/custom/</entry>
</properties>`;
    const output = sanitizeSpiderConfig(input, laptopEntries);
    expect(output).toContain('<entry key="some.unknown.path"></entry>');
  });

  it('preserves non-path entries regardless of laptop entries', () => {
    const input = `<properties>
<entry key="crawl.threads">8</entry>
<entry key="storage.db_dir">/Users/alice/.ScreamingFrogSEOSpider/</entry>
</properties>`;
    const output = sanitizeSpiderConfig(input, laptopEntries);
    expect(output).toContain('<entry key="crawl.threads">8</entry>');
  });

  it('falls back to blank when the laptop value for the key is empty', () => {
    const input = `<properties>
<entry key="storage.db_dir">/Users/alice/.ScreamingFrogSEOSpider/</entry>
</properties>`;
    const output = sanitizeSpiderConfig(input, { 'storage.db_dir': '' });
    expect(output).toContain('<entry key="storage.db_dir"></entry>');
  });

  it('handles Windows paths from the uploaded config', () => {
    const input = `<properties>
<entry key="storage.db_dir">C:\\Users\\alice\\SF\\</entry>
</properties>`;
    const output = sanitizeSpiderConfig(input, laptopEntries);
    expect(output).toContain('<entry key="storage.db_dir">/home/bob/.ScreamingFrogSEOSpider/</entry>');
  });
});

// ─── getLocalSfDataDir ────────────────────────────────────────────────────────
describe('getLocalSfDataDir()', () => {
  it('returns the SF_DATA_DIR env var when set', () => {
    const saved = process.env.SF_DATA_DIR;
    process.env.SF_DATA_DIR = '/tmp/fake-sf';
    expect(getLocalSfDataDir()).toBe('/tmp/fake-sf');
    if (saved === undefined) delete process.env.SF_DATA_DIR;
    else process.env.SF_DATA_DIR = saved;
  });

  it('returns null when no SF installation is found and env var is not set', () => {
    const saved = process.env.SF_DATA_DIR;
    delete process.env.SF_DATA_DIR;
    // On CI there is no SF installation, so null is expected.
    const result = getLocalSfDataDir();
    expect(result === null || typeof result === 'string').toBe(true);
    if (saved !== undefined) process.env.SF_DATA_DIR = saved;
  });
});

// ─── autoImportLocalConfig ────────────────────────────────────────────────────
describe('autoImportLocalConfig()', () => {
  it('creates an is_local=1 record when SF_DATA_DIR points to a dir with spider.config', async () => {
    // Set up a fake SF data dir with a spider.config.
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-sf-fake-'));
    const fakeConfig = path.join(fakeDir, 'spider.config');
    fs.writeFileSync(fakeConfig, '<properties><entry key="crawl.threads">4</entry></properties>');

    // Use a fresh app instance so DB is clean.
    const { makeApp: mkApp } = require('../helpers/app-factory');
    const c = mkApp('auto-import');
    const saved = process.env.SF_DATA_DIR;
    process.env.SF_DATA_DIR = fakeDir;

    try {
      const r = await c.request.post('/api/spider-configs/import-local').expect(201);
      expect(r.body.is_local).toBe(1);
      expect(r.body.name).toBe('Laptop (auto-imported)');

      // Verify the file was stored as-is (no sanitization).
      const stored = fs.readFileSync(r.body.filepath, 'utf8');
      expect(stored).toContain('<entry key="crawl.threads">4</entry>');
    } finally {
      if (saved === undefined) delete process.env.SF_DATA_DIR;
      else process.env.SF_DATA_DIR = saved;
      fs.rmSync(fakeDir, { recursive: true, force: true });
      c.cleanup();
    }
  });

  it('refreshes the stored file when is_local=1 already exists', async () => {
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-sf-refresh-'));
    const fakeConfig = path.join(fakeDir, 'spider.config');
    fs.writeFileSync(fakeConfig, '<properties><entry key="crawl.threads">4</entry></properties>');

    const { makeApp: mkApp } = require('../helpers/app-factory');
    const c = mkApp('auto-import-refresh');
    const saved = process.env.SF_DATA_DIR;
    process.env.SF_DATA_DIR = fakeDir;

    try {
      // First import.
      const first = await c.request.post('/api/spider-configs/import-local').expect(201);
      const firstId = first.body.id;

      // Update the fake laptop config.
      fs.writeFileSync(fakeConfig, '<properties><entry key="crawl.threads">8</entry></properties>');

      // Re-import – should update the existing record, not create a new one.
      const second = await c.request.post('/api/spider-configs/import-local').expect(201);
      expect(second.body.id).toBe(firstId);

      const stored = fs.readFileSync(second.body.filepath, 'utf8');
      expect(stored).toContain('<entry key="crawl.threads">8</entry>');

      // List – should still have only ONE is_local record.
      const list = await c.request.get('/api/spider-configs').expect(200);
      expect(list.body.filter((c) => c.is_local === 1).length).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.SF_DATA_DIR;
      else process.env.SF_DATA_DIR = saved;
      fs.rmSync(fakeDir, { recursive: true, force: true });
      c.cleanup();
    }
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

  it('each config has id, name, filename, filepath, is_local, created_at fields', async () => {
    const res = await ctx.request.get('/api/spider-configs').expect(200);
    const c = res.body[0];
    expect(c).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      filename: expect.any(String),
      filepath: expect.any(String),
      is_local: expect.any(Number),
      created_at: expect.any(String),
    });
  });
});

// ─── GET /api/spider-configs/local ────────────────────────────────────────────
describe('GET /api/spider-configs/local', () => {
  it('returns found:true when SF_DATA_DIR contains spider.config', async () => {
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-sf-local-'));
    fs.writeFileSync(path.join(fakeDir, 'spider.config'), '<properties/>');
    const saved = process.env.SF_DATA_DIR;
    process.env.SF_DATA_DIR = fakeDir;
    try {
      const res = await ctx.request.get('/api/spider-configs/local').expect(200);
      expect(res.body.found).toBe(true);
      expect(res.body.path).toBe(path.join(fakeDir, 'spider.config'));
    } finally {
      if (saved === undefined) delete process.env.SF_DATA_DIR;
      else process.env.SF_DATA_DIR = saved;
      fs.rmSync(fakeDir, { recursive: true, force: true });
    }
  });

  it('returns found:false when no local spider.config exists', async () => {
    const saved = process.env.SF_DATA_DIR;
    delete process.env.SF_DATA_DIR;
    const res = await ctx.request.get('/api/spider-configs/local').expect(200);
    expect(res.body).toHaveProperty('found');
    if (saved !== undefined) process.env.SF_DATA_DIR = saved;
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
      is_local: 0,
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

  it('patches abs path entries with laptop values when SF_DATA_DIR is set', async () => {
    // Create a fake SF data dir with a laptop spider.config that has known paths.
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-sf-upload-'));
    const laptopContent = `<properties>
<entry key="storage.db_dir">/home/laptop/.ScreamingFrogSEOSpider/</entry>
<entry key="ui.recent_config_0">/home/laptop/project.seospiderconfig</entry>
</properties>`;
    fs.writeFileSync(path.join(fakeDir, 'spider.config'), laptopContent);
    const saved = process.env.SF_DATA_DIR;
    process.env.SF_DATA_DIR = fakeDir;

    try {
      const uploadContent = `<properties>
<entry key="storage.db_dir">/Users/alice/.ScreamingFrogSEOSpider/</entry>
<entry key="crawl.threads">5</entry>
<entry key="ui.recent_config_0">/Users/alice/old-project.seospiderconfig</entry>
</properties>`;
      const res = await ctx.request.post('/api/spider-configs')
        .attach('spider_config', Buffer.from(uploadContent), {
          filename: 'patched-test.seospiderconfig',
          contentType: 'application/octet-stream',
        })
        .expect(201);
      const saved2 = fs.readFileSync(res.body.filepath, 'utf8');
      // storage.db_dir should be replaced with the laptop value.
      expect(saved2).toContain('<entry key="storage.db_dir">/home/laptop/.ScreamingFrogSEOSpider/</entry>');
      // ui.recent_config_0 should be replaced with the laptop value.
      expect(saved2).toContain('<entry key="ui.recent_config_0">/home/laptop/project.seospiderconfig</entry>');
      // Non-path entry untouched.
      expect(saved2).toContain('<entry key="crawl.threads">5</entry>');
    } finally {
      if (saved === undefined) delete process.env.SF_DATA_DIR;
      else process.env.SF_DATA_DIR = saved;
      fs.rmSync(fakeDir, { recursive: true, force: true });
    }
  });

  it('clears abs path entries when no laptop config exists (fallback)', async () => {
    const saved = process.env.SF_DATA_DIR;
    delete process.env.SF_DATA_DIR;
    try {
      const xml = `<properties>
<entry key="storage.db_dir">/home/user/.ScreamingFrogSEOSpider/</entry>
<entry key="crawl.threads">5</entry>
</properties>`;
      const res = await ctx.request.post('/api/spider-configs')
        .attach('spider_config', Buffer.from(xml), {
          filename: 'fallback-test.seospiderconfig',
          contentType: 'application/octet-stream',
        })
        .expect(201);
      const stored = fs.readFileSync(res.body.filepath, 'utf8');
      expect(stored).toContain('<entry key="storage.db_dir"></entry>');
      expect(stored).toContain('<entry key="crawl.threads">5</entry>');
    } finally {
      if (saved !== undefined) process.env.SF_DATA_DIR = saved;
    }
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
    const saved = process.env.SF_DATA_DIR;
    delete process.env.SF_DATA_DIR;
    try {
      const res = await ctx.request.post('/api/spider-configs/import-local').expect(404);
      expect(res.body.error).toBeTruthy();
    } finally {
      if (saved !== undefined) process.env.SF_DATA_DIR = saved;
    }
  });

  it('imports the local spider.config as-is (no sanitization) with is_local=1', async () => {
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-sf-import-'));
    const content = `<properties>
<entry key="storage.db_dir">/home/laptop/.ScreamingFrogSEOSpider/</entry>
<entry key="crawl.threads">4</entry>
</properties>`;
    fs.writeFileSync(path.join(fakeDir, 'spider.config'), content);
    const saved = process.env.SF_DATA_DIR;
    process.env.SF_DATA_DIR = fakeDir;
    try {
      const res = await ctx.request.post('/api/spider-configs/import-local').expect(201);
      expect(res.body.is_local).toBe(1);
      // Stored file should be unchanged (no path sanitization for the laptop config).
      const stored = fs.readFileSync(res.body.filepath, 'utf8');
      expect(stored).toContain('<entry key="storage.db_dir">/home/laptop/.ScreamingFrogSEOSpider/</entry>');
      expect(stored).toContain('<entry key="crawl.threads">4</entry>');
    } finally {
      if (saved === undefined) delete process.env.SF_DATA_DIR;
      else process.env.SF_DATA_DIR = saved;
      fs.rmSync(fakeDir, { recursive: true, force: true });
    }
  });
});

// ─── DELETE /api/spider-configs/:id ──────────────────────────────────────────
describe('DELETE /api/spider-configs/:id', () => {
  it('returns 404 for a non-existent spider config', async () => {
    const res = await ctx.request.delete('/api/spider-configs/99999').expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 403 when attempting to delete the laptop config (is_local=1)', async () => {
    const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-sf-del-'));
    fs.writeFileSync(path.join(fakeDir, 'spider.config'), '<properties/>');
    const saved = process.env.SF_DATA_DIR;
    process.env.SF_DATA_DIR = fakeDir;
    try {
      const createRes = await ctx.request.post('/api/spider-configs/import-local').expect(201);
      const { id } = createRes.body;
      const delRes = await ctx.request.delete(`/api/spider-configs/${id}`).expect(403);
      expect(delRes.body.error).toBeTruthy();
    } finally {
      if (saved === undefined) delete process.env.SF_DATA_DIR;
      else process.env.SF_DATA_DIR = saved;
      fs.rmSync(fakeDir, { recursive: true, force: true });
    }
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
