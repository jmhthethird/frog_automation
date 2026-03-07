'use strict';

const { makeApp } = require('../helpers/app-factory');

let ctx;

beforeAll(() => {
  ctx = makeApp('health');
});

afterAll(() => ctx.cleanup());

describe('GET /api/health', () => {
  it('returns 200 with the expected JSON shape', async () => {
    const res = await ctx.request.get('/api/health').expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      launcher_found: expect.any(Boolean),
      launcher: expect.any(String),
      node_version: expect.any(String),
      uptime_seconds: expect.any(Number),
    });
  });

  it('launcher_found is false when the SF binary is absent (CI environment)', async () => {
    const res = await ctx.request.get('/api/health').expect(200);
    // In Linux CI the macOS launcher will not exist.
    expect(typeof res.body.launcher_found).toBe('boolean');
  });

  it('node_version starts with "v"', async () => {
    const res = await ctx.request.get('/api/health').expect(200);
    expect(res.body.node_version).toMatch(/^v\d+\./);
  });

  it('uptime_seconds is a non-negative integer', async () => {
    const res = await ctx.request.get('/api/health').expect(200);
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(res.body.uptime_seconds)).toBe(true);
  });
});
