'use strict';

const path = require('path');
const fs   = require('fs');

const { makeApp } = require('../helpers/app-factory');

let ctx;

beforeAll(() => {
  ctx = makeApp('profiles');
});

afterAll(() => ctx.cleanup());

// ─── GET /api/profiles ────────────────────────────────────────────────────────
describe('GET /api/profiles', () => {
  it('returns an empty array when no profiles exist', async () => {
    const res = await ctx.request.get('/api/profiles').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns profiles after one is uploaded', async () => {
    await uploadProfile(ctx.request, 'list-test.seospiderconfig');
    const res = await ctx.request.get('/api/profiles').expect(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('each profile has id, name, filename, filepath, created_at fields', async () => {
    const res = await ctx.request.get('/api/profiles').expect(200);
    const p = res.body[0];
    expect(p).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      filename: expect.any(String),
      filepath: expect.any(String),
      created_at: expect.any(String),
    });
  });
});

// ─── POST /api/profiles ───────────────────────────────────────────────────────
describe('POST /api/profiles', () => {
  it('returns 400 when no file is attached', async () => {
    const res = await ctx.request.post('/api/profiles').expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when the uploaded file has the wrong extension', async () => {
    const content = Buffer.from('not a config');
    const res = await ctx.request.post('/api/profiles')
      .attach('profile', content, { filename: 'config.txt', contentType: 'text/plain' })
      .expect(400);
    expect(res.body.error).toMatch(/seospiderconfig/i);
  });

  it('returns 400 when the uploaded file has a disguised wrong extension', async () => {
    const content = Buffer.from('<xml/>');
    const res = await ctx.request.post('/api/profiles')
      .attach('profile', content, { filename: 'evil.xml', contentType: 'application/xml' })
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 201 and persists a valid .seospiderconfig upload', async () => {
    const res = await uploadProfile(ctx.request, 'valid.seospiderconfig');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(Number),
      filename: expect.stringMatching(/valid\.seospiderconfig$/),
      filepath: expect.any(String),
      created_at: expect.any(String),
    });
    // File must actually exist on disk.
    expect(fs.existsSync(res.body.filepath)).toBe(true);
  });

  it('uses the provided display name', async () => {
    const content = Buffer.from('<config/>');
    const res = await ctx.request.post('/api/profiles')
      .attach('profile', content, { filename: 'named.seospiderconfig', contentType: 'application/octet-stream' })
      .field('name', 'My Custom Profile')
      .expect(201);
    expect(res.body.name).toBe('My Custom Profile');
  });

  it('derives name from filename when no display name is given', async () => {
    const content = Buffer.from('<config/>');
    const res = await ctx.request.post('/api/profiles')
      .attach('profile', content, { filename: 'derived-name.seospiderconfig', contentType: 'application/octet-stream' })
      .expect(201);
    expect(res.body.name).toBe('derived-name');
  });

  it('returns 400 when the file exceeds 10 MB', async () => {
    // Create a buffer just over 10 MB.
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 'x');
    const res = await ctx.request.post('/api/profiles')
      .attach('profile', big, { filename: 'toobig.seospiderconfig', contentType: 'application/octet-stream' })
      .expect(400);
    expect(res.body.error).toMatch(/too large/i);
  });
});

// ─── DELETE /api/profiles/:id ─────────────────────────────────────────────────
describe('DELETE /api/profiles/:id', () => {
  it('returns 404 for a non-existent profile', async () => {
    const res = await ctx.request.delete('/api/profiles/99999').expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('deletes the profile record and removes the file from disk', async () => {
    const createRes = await uploadProfile(ctx.request, 'to-delete.seospiderconfig');
    const { id, filepath } = createRes.body;

    expect(fs.existsSync(filepath)).toBe(true);

    await ctx.request.delete(`/api/profiles/${id}`).expect(200);

    // Record gone from DB.
    await ctx.request.get('/api/profiles').then((r) => {
      const ids = r.body.map((p) => p.id);
      expect(ids).not.toContain(id);
    });

    // File gone from disk.
    expect(fs.existsSync(filepath)).toBe(false);
  });

  it('still returns 200 when the backing file has already been removed', async () => {
    const createRes = await uploadProfile(ctx.request, 'already-gone.seospiderconfig');
    const { id, filepath } = createRes.body;

    // Delete the file manually before calling the API.
    fs.unlinkSync(filepath);

    // API should still succeed (catches the ENOENT).
    await ctx.request.delete(`/api/profiles/${id}`).expect(200);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uploadProfile(request, filename) {
  const content = Buffer.from('<config/>');
  return request.post('/api/profiles')
    .attach('profile', content, { filename, contentType: 'application/octet-stream' });
}
