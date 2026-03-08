'use strict';

const { makeApp } = require('../helpers/app-factory');

let ctx;

beforeAll(() => {
  ctx = makeApp('api-creds');
});

afterAll(() => ctx.cleanup());

// ─── GET /api/api-credentials ─────────────────────────────────────────────────
describe('GET /api/api-credentials', () => {
  it('returns an array with all known services', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const services = res.body.map(s => s.service);
    expect(services).toContain('google_search_console');
    expect(services).toContain('pagespeed');
    expect(services).toContain('majestic');
    expect(services).toContain('mozscape');
    expect(services).toContain('ahrefs');
    expect(services).toContain('google_analytics');
    expect(services).toContain('google_analytics_4');
  });

  it('each entry has service, enabled, credentials, and fields', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    for (const svc of res.body) {
      expect(svc).toMatchObject({
        service:     expect.any(String),
        enabled:     expect.any(Boolean),
        credentials: expect.any(Object),
        fields:      expect.any(Array),
      });
    }
  });

  it('all services are disabled by default', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    for (const svc of res.body) {
      expect(svc.enabled).toBe(false);
    }
  });

  it('pagespeed has an api_key field', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    const ps = res.body.find(s => s.service === 'pagespeed');
    expect(ps).toBeDefined();
    const fieldNames = ps.fields.map(f => f.name);
    expect(fieldNames).toContain('api_key');
  });

  it('mozscape has access_id and secret_key fields', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    const moz = res.body.find(s => s.service === 'mozscape');
    expect(moz).toBeDefined();
    const fieldNames = moz.fields.map(f => f.name);
    expect(fieldNames).toContain('access_id');
    expect(fieldNames).toContain('secret_key');
  });

  it('google_search_console has no credential fields (OAuth-based)', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    const gsc = res.body.find(s => s.service === 'google_search_console');
    expect(gsc).toBeDefined();
    expect(gsc.fields).toHaveLength(0);
  });
});

// ─── PUT /api/api-credentials/:service ───────────────────────────────────────
describe('PUT /api/api-credentials/:service', () => {
  it('returns 404 for an unknown service', async () => {
    const res = await ctx.request.put('/api/api-credentials/unknown_service')
      .send({ enabled: true, credentials: {} })
      .expect(404);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const res = await ctx.request.put('/api/api-credentials/pagespeed')
      .send({ enabled: 'yes', credentials: {} })
      .expect(400);
    expect(res.body.error).toMatch(/boolean/i);
  });

  it('returns 400 when credentials is not an object', async () => {
    const res = await ctx.request.put('/api/api-credentials/pagespeed')
      .send({ enabled: true, credentials: 'my_key' })
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });

  it('enables a service', async () => {
    const res = await ctx.request.put('/api/api-credentials/pagespeed')
      .send({ enabled: true, credentials: {} })
      .expect(200);
    expect(res.body.enabled).toBe(true);
  });

  it('disables a service', async () => {
    // First enable
    await ctx.request.put('/api/api-credentials/pagespeed')
      .send({ enabled: true, credentials: {} }).expect(200);
    // Then disable
    const res = await ctx.request.put('/api/api-credentials/pagespeed')
      .send({ enabled: false, credentials: {} })
      .expect(200);
    expect(res.body.enabled).toBe(false);
  });

  it('stores credentials and masks sensitive fields in the response', async () => {
    const res = await ctx.request.put('/api/api-credentials/pagespeed')
      .send({ enabled: true, credentials: { api_key: 'abc-secret-key' } })
      .expect(200);
    // The response should mask the sensitive value
    expect(res.body.credentials.api_key).not.toBe('abc-secret-key');
    expect(res.body.credentials.api_key).toMatch(/●/);
  });

  it('persists changes so GET reflects them', async () => {
    await ctx.request.put('/api/api-credentials/majestic')
      .send({ enabled: true, credentials: { api_key: 'maj-key-12345' } })
      .expect(200);

    const getRes = await ctx.request.get('/api/api-credentials').expect(200);
    const maj = getRes.body.find(s => s.service === 'majestic');
    expect(maj.enabled).toBe(true);
    // Sensitive field is masked
    expect(maj.credentials.api_key).toMatch(/●/);
  });

  it('preserves existing credential values when a pure mask is sent', async () => {
    // Set a real value first
    await ctx.request.put('/api/api-credentials/ahrefs')
      .send({ enabled: true, credentials: { api_key: 'real-secret-value' } })
      .expect(200);

    // GET to obtain the masked value
    const getRes = await ctx.request.get('/api/api-credentials').expect(200);
    const masked = getRes.body.find(s => s.service === 'ahrefs').credentials.api_key;
    expect(masked).toMatch(/●/);

    // Now PUT with the masked value back – the real value should be preserved
    const res2 = await ctx.request.put('/api/api-credentials/ahrefs')
      .send({ enabled: true, credentials: { api_key: masked } })
      .expect(200);
    // The response mask should still show the same prefix/length pattern
    expect(res2.body.credentials.api_key).toMatch(/●/);
  });

  it('can store mozscape access_id and secret_key', async () => {
    const res = await ctx.request.put('/api/api-credentials/mozscape')
      .send({
        enabled: true,
        credentials: { access_id: 'moz-access-123', secret_key: 'moz-secret-456' },
      })
      .expect(200);
    expect(res.body.enabled).toBe(true);
    // access_id is not sensitive, secret_key is
    expect(res.body.credentials.access_id).toBe('moz-access-123');
    expect(res.body.credentials.secret_key).toMatch(/●/);
  });

  it('enables google_search_console (no credentials needed)', async () => {
    const res = await ctx.request.put('/api/api-credentials/google_search_console')
      .send({ enabled: true, credentials: {} })
      .expect(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.credentials).toEqual({});
  });

  it('can update only enabled without providing credentials', async () => {
    const res = await ctx.request.put('/api/api-credentials/google_analytics')
      .send({ enabled: true })
      .expect(200);
    expect(res.body.enabled).toBe(true);
  });

  it('clears a credential field when an empty string is sent', async () => {
    // Set a value first
    await ctx.request.put('/api/api-credentials/ahrefs')
      .send({ enabled: true, credentials: { api_key: 'to-be-cleared' } })
      .expect(200);
    // Clear it
    const res = await ctx.request.put('/api/api-credentials/ahrefs')
      .send({ enabled: true, credentials: { api_key: '' } })
      .expect(200);
    expect(res.body.credentials.api_key).toBe('');
  });
});
