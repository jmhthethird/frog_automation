'use strict';

const { makeApp } = require('../helpers/app-factory');

let ctx;
let db;
let SERVICE_FIELDS;

beforeAll(() => {
  ctx = makeApp('api-creds');
  // Capture the db instance that was loaded as part of this app context.
  // Must be required AFTER makeApp() since makeApp() calls jest.resetModules().
  ({ db } = require('../../src/db'));
  ({ SERVICE_FIELDS } = require('../../src/routes/api-credentials'));
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
    expect(services).toContain('google_drive');
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

  it('google_search_console has no credential fields (OAuth-based)', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    const gsc = res.body.find(s => s.service === 'google_search_console');
    expect(gsc).toBeDefined();
    expect(gsc.fields).toHaveLength(0);
  });

  it('google_drive has api_key, client_id, and client_secret fields', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    const gd = res.body.find(s => s.service === 'google_drive');
    expect(gd).toBeDefined();
    const names = gd.fields.map(f => f.name);
    expect(names).toContain('api_key');
    expect(names).toContain('client_id');
    expect(names).toContain('client_secret');
  });

  it('google_drive client_secret field is marked sensitive', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    const gd = res.body.find(s => s.service === 'google_drive');
    const secretField = gd.fields.find(f => f.name === 'client_secret');
    expect(secretField.sensitive).toBe(true);
  });

  it('google_drive api_key field is marked sensitive', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    const gd = res.body.find(s => s.service === 'google_drive');
    const apiKeyField = gd.fields.find(f => f.name === 'api_key');
    expect(apiKeyField.sensitive).toBe(true);
  });

  it('google_drive client_id field is not marked sensitive', async () => {
    const res = await ctx.request.get('/api/api-credentials').expect(200);
    const gd = res.body.find(s => s.service === 'google_drive');
    expect(gd.fields.find(f => f.name === 'client_id').sensitive).toBeFalsy();
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

  it('returns empty credentials for services with no defined fields', async () => {
    const res = await ctx.request.put('/api/api-credentials/pagespeed')
      .send({ enabled: true, credentials: { api_key: 'abc-secret-key' } })
      .expect(200);
    // pagespeed no longer has credential fields, so credentials object is empty
    expect(res.body.credentials).toEqual({});
  });

  it('persists changes so GET reflects them', async () => {
    await ctx.request.put('/api/api-credentials/majestic')
      .send({ enabled: true, credentials: { api_key: 'maj-key-12345' } })
      .expect(200);

    const getRes = await ctx.request.get('/api/api-credentials').expect(200);
    const maj = getRes.body.find(s => s.service === 'majestic');
    expect(maj.enabled).toBe(true);
    // majestic no longer exposes credential fields
    expect(maj.fields).toHaveLength(0);
  });

  it('returns empty credentials for services without defined credential fields and does not persist them', async () => {
    // ahrefs no longer has credential fields; sending api_key should be accepted but not persisted
    await ctx.request.put('/api/api-credentials/ahrefs')
      .send({ enabled: true, credentials: { api_key: 'real-secret-value' } })
      .expect(200);

    const getRes = await ctx.request.get('/api/api-credentials').expect(200);
    const ahrefs = getRes.body.find(s => s.service === 'ahrefs');
    expect(ahrefs.enabled).toBe(true);
    expect(ahrefs.credentials).toEqual({});

    // Verify the secret was not silently persisted in the database.
    const row = db.prepare('SELECT credentials FROM api_credentials WHERE service = ?').get('ahrefs');
    const stored = JSON.parse(row?.credentials || '{}');
    expect(stored).toEqual({});
  });

  it('does not persist credentials for pagespeed', async () => {
    await ctx.request.put('/api/api-credentials/pagespeed')
      .send({ enabled: true, credentials: { api_key: 'ps-secret-123' } })
      .expect(200);

    const row = db.prepare('SELECT credentials FROM api_credentials WHERE service = ?').get('pagespeed');
    const stored = JSON.parse(row?.credentials || '{}');
    expect(stored).toEqual({});
  });

  it('can update mozscape (no credential fields exposed)', async () => {
    const res = await ctx.request.put('/api/api-credentials/mozscape')
      .send({
        enabled: true,
        credentials: { access_id: 'moz-access-123', secret_key: 'moz-secret-456' },
      })
      .expect(200);
    expect(res.body.enabled).toBe(true);
    // mozscape no longer exposes credential fields
    expect(res.body.credentials).toEqual({});
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

  it('accepts empty credential values for services without defined credential fields', async () => {
    // ahrefs no longer has exposed credential fields; sending credentials is accepted
    const res = await ctx.request.put('/api/api-credentials/ahrefs')
      .send({ enabled: true, credentials: { api_key: '' } })
      .expect(200);
    expect(res.body.credentials).toEqual({});
  });
});

// ─── Credential field handling (with injected test fields) ───────────────────
// These tests temporarily add a field definition to a service so the masking
// and field-seeding code paths can be exercised.
describe('PUT/GET credential field handling with defined fields', () => {
  beforeEach(() => {
    // Temporarily give google_analytics_4 a sensitive field so we can test
    // the masking logic and the allowed-fields seeding in the PUT handler.
    SERVICE_FIELDS.google_analytics_4 = [{ name: 'api_secret', sensitive: true }];
  });

  afterEach(() => {
    SERVICE_FIELDS.google_analytics_4 = [];
  });

  it('stores and masks a sensitive field via PUT, returns masked value in response', async () => {
    const res = await ctx.request.put('/api/api-credentials/google_analytics_4')
      .send({ enabled: true, credentials: { api_secret: 'supersecret-1234' } })
      .expect(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.credentials.api_secret).toMatch(/●/);
    expect(res.body.credentials.api_secret).not.toContain('supersecret');
  });

  it('GET returns masked sensitive credential value', async () => {
    // First store a value
    await ctx.request.put('/api/api-credentials/google_analytics_4')
      .send({ enabled: true, credentials: { api_secret: 'verylongsecret' } })
      .expect(200);

    const getRes = await ctx.request.get('/api/api-credentials').expect(200);
    const ga4 = getRes.body.find(s => s.service === 'google_analytics_4');
    expect(ga4.credentials.api_secret).toMatch(/●/);
  });

  it('leaves existing value unchanged when masked string is re-submitted', async () => {
    // Store original value
    await ctx.request.put('/api/api-credentials/google_analytics_4')
      .send({ enabled: true, credentials: { api_secret: 'original-secret' } })
      .expect(200);

    // Fetch the masked value
    const getRes = await ctx.request.get('/api/api-credentials').expect(200);
    const masked = getRes.body.find(s => s.service === 'google_analytics_4').credentials.api_secret;
    expect(masked).toMatch(/●/);

    // Re-submit the masked value; the stored secret should be unchanged
    await ctx.request.put('/api/api-credentials/google_analytics_4')
      .send({ enabled: true, credentials: { api_secret: masked } })
      .expect(200);

    const row = db.prepare('SELECT credentials FROM api_credentials WHERE service = ?').get('google_analytics_4');
    const stored = JSON.parse(row?.credentials || '{}');
    expect(stored.api_secret).toBe('original-secret');
  });

  it('seeds existing stored value when field is already in the DB', async () => {
    // Store a value, then call PUT without credentials – field should be preserved
    await ctx.request.put('/api/api-credentials/google_analytics_4')
      .send({ enabled: true, credentials: { api_secret: 'stored-value' } })
      .expect(200);

    const res = await ctx.request.put('/api/api-credentials/google_analytics_4')
      .send({ enabled: false })
      .expect(200);

    expect(res.body.enabled).toBe(false);
    // The stored credential is not exposed in the response only when sensitive
    expect(res.body.credentials.api_secret).toMatch(/●/);

    const row = db.prepare('SELECT credentials FROM api_credentials WHERE service = ?').get('google_analytics_4');
    const stored = JSON.parse(row?.credentials || '{}');
    expect(stored.api_secret).toBe('stored-value');
  });

  it('maskValue handles short values (≤4 chars) and empty values', async () => {
    // Store a short secret (≤4 chars) and verify it is fully masked
    const res = await ctx.request.put('/api/api-credentials/google_analytics_4')
      .send({ enabled: true, credentials: { api_secret: 'abc' } })
      .expect(200);
    // Short value: every char should be masked as ●
    expect(res.body.credentials.api_secret).toMatch(/^●+$/);
    expect(res.body.credentials.api_secret).toHaveLength(3);
  });

  it('maskValue handles empty/null stored value', async () => {
    // Store empty value
    await ctx.request.put('/api/api-credentials/google_analytics_4')
      .send({ enabled: true, credentials: { api_secret: '' } })
      .expect(200);

    const getRes = await ctx.request.get('/api/api-credentials').expect(200);
    const ga4 = getRes.body.find(s => s.service === 'google_analytics_4');
    expect(ga4.credentials.api_secret).toBe('');
  });
});
