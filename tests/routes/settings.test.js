'use strict';

const { makeApp } = require('../helpers/app-factory');

let ctx;

beforeAll(() => {
  ctx = makeApp('settings');
});

afterAll(() => ctx.cleanup());

// ─── GET /api/settings ────────────────────────────────────────────────────────
describe('GET /api/settings', () => {
  it('returns 200 with a JSON object containing queue_concurrency', async () => {
    const res = await ctx.request.get('/api/settings').expect(200);
    expect(res.body).toMatchObject({ queue_concurrency: expect.any(String) });
  });

  it('queue_concurrency defaults to "1"', async () => {
    const res = await ctx.request.get('/api/settings').expect(200);
    expect(res.body.queue_concurrency).toBe('1');
  });
});

// ─── PATCH /api/settings ──────────────────────────────────────────────────────
describe('PATCH /api/settings', () => {
  it('updates queue_concurrency to a valid value', async () => {
    const res = await ctx.request
      .patch('/api/settings')
      .send({ queue_concurrency: '3' })
      .set('Content-Type', 'application/json')
      .expect(200);
    expect(res.body.queue_concurrency).toBe('3');
  });

  it('persists the new value in subsequent GET', async () => {
    await ctx.request
      .patch('/api/settings')
      .send({ queue_concurrency: '4' })
      .set('Content-Type', 'application/json')
      .expect(200);

    const res = await ctx.request.get('/api/settings').expect(200);
    expect(res.body.queue_concurrency).toBe('4');
  });

  it('accepts numeric value as well as string', async () => {
    const res = await ctx.request
      .patch('/api/settings')
      .send({ queue_concurrency: 2 })
      .set('Content-Type', 'application/json')
      .expect(200);
    expect(res.body.queue_concurrency).toBe('2');
  });

  it('rejects concurrency below 1', async () => {
    const res = await ctx.request
      .patch('/api/settings')
      .send({ queue_concurrency: '0' })
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(res.body.errors).toHaveProperty('queue_concurrency');
  });

  it('rejects concurrency above 8', async () => {
    const res = await ctx.request
      .patch('/api/settings')
      .send({ queue_concurrency: '9' })
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(res.body.errors).toHaveProperty('queue_concurrency');
  });

  it('rejects unknown settings keys', async () => {
    const res = await ctx.request
      .patch('/api/settings')
      .send({ unknown_key: 'value' })
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(res.body.errors).toHaveProperty('unknown_key');
  });

  it('returns 400 when body is not a JSON object', async () => {
    const res = await ctx.request
      .patch('/api/settings')
      .send([{ queue_concurrency: '2' }])
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(res.body).toHaveProperty('error');
  });

  it('updates the live queue concurrency', async () => {
    const queue = ctx.app.get('queue');
    await ctx.request
      .patch('/api/settings')
      .send({ queue_concurrency: '5' })
      .set('Content-Type', 'application/json')
      .expect(200);
    expect(queue.concurrency).toBe(5);
  });
});
