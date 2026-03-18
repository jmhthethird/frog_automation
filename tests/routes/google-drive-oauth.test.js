'use strict';

/**
 * Tests for OAuth-dependent endpoints: GET /api/google-drive/callback and
 * GET /api/google-drive/token.
 *
 * googleapis is mocked at the top level so the jest.mock() factory is hoisted
 * before any require() calls and persists through makeApp()'s internal
 * jest.resetModules(), giving us full control over the OAuth2 client.
 *
 * Variable names starting with 'mock' are allowlisted by babel-jest so they
 * can be referenced inside the jest.mock() factory even though it is hoisted.
 */

const mockGetToken       = jest.fn();
const mockGetAccessToken = jest.fn();

jest.mock('googleapis', () => {
  const OAuth2 = jest.fn(function () {
    this.setCredentials = jest.fn();
  });
  // Include the state parameter in the mock URL so tests can extract it.
  OAuth2.prototype.generateAuthUrl = jest.fn(opts =>
    'https://accounts.google.com/mock-auth?state=' + encodeURIComponent(opts?.state || '')
  );
  OAuth2.prototype.getToken       = mockGetToken;
  OAuth2.prototype.getAccessToken = mockGetAccessToken;

  return {
    google: {
      auth:  { OAuth2 },
      drive: jest.fn(() => ({ files: { list: jest.fn(), create: jest.fn() } })),
    },
  };
});

const { makeApp } = require('../helpers/app-factory');

let ctx;
let db;

beforeAll(() => {
  ctx = makeApp('gd-oauth');
  ({ db } = require('../../src/db'));
});

afterAll(() => ctx.cleanup());

beforeEach(() => {
  mockGetToken.mockReset();
  mockGetAccessToken.mockReset();
  // Reset credentials to a clean baseline (client_id/secret set so /auth-url
  // works for state generation; no refresh_token).
  seedCreds({ client_id: 'cid', client_secret: 'cs' });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedCreds(overrides = {}) {
  const creds = { api_key: '', client_id: '', client_secret: '', ...overrides };
  db.prepare(`
    INSERT INTO api_credentials (service, enabled, credentials)
    VALUES ('google_drive', 0, ?)
    ON CONFLICT(service) DO UPDATE SET credentials = excluded.credentials
  `).run(JSON.stringify(creds));
}

/**
 * Register a fresh CSRF state by calling /auth-url and extract it from the
 * returned URL.  Credentials must already have client_id and client_secret set.
 */
async function getValidState() {
  const r = await ctx.request.get('/api/google-drive/auth-url').expect(200);
  return new URL(r.body.url).searchParams.get('state');
}

// ─── GET /api/google-drive/callback ──────────────────────────────────────────
describe('GET /api/google-drive/callback', () => {
  it('returns error postMessage when "error" query param is present', async () => {
    const res = await ctx.request
      .get('/api/google-drive/callback?error=access_denied')
      .expect(200);
    expect(res.text).toContain('drive-auth-error');
    expect(res.text).toContain('access_denied');
  });

  it('escapes HTML-special characters in the error value (XSS prevention)', async () => {
    const res = await ctx.request
      .get('/api/google-drive/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E')
      .expect(200);
    // The raw string </script> must NOT appear unescaped in the HTML page.
    expect(res.text).not.toContain('<script>alert');
    // The escaped form should be present instead.
    expect(res.text).toContain('\\u003c');
  });

  it('returns error postMessage when code is missing', async () => {
    const res = await ctx.request.get('/api/google-drive/callback').expect(200);
    expect(res.text).toContain('drive-auth-error');
    expect(res.text).toContain('Missing authorization code');
  });

  it('returns error postMessage when state is missing', async () => {
    const res = await ctx.request
      .get('/api/google-drive/callback?code=testcode')
      .expect(200);
    expect(res.text).toContain('drive-auth-error');
  });

  it('returns error postMessage when state is unknown', async () => {
    const res = await ctx.request
      .get('/api/google-drive/callback?code=testcode&state=notaregisteredstate')
      .expect(200);
    expect(res.text).toContain('drive-auth-error');
    expect(res.text).toContain('state');
  });

  it('stores refresh_token and returns success postMessage on successful exchange', async () => {
    const state = await getValidState();
    mockGetToken.mockResolvedValueOnce({ tokens: { refresh_token: 'new_rt', access_token: 'at' } });

    const res = await ctx.request
      .get(`/api/google-drive/callback?code=authcode&state=${encodeURIComponent(state)}`)
      .expect(200);

    expect(res.text).toContain('drive-auth-success');
    const row = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    expect(JSON.parse(row.credentials).refresh_token).toBe('new_rt');
  });

  it('returns success when Google returns no refresh_token but one is already stored', async () => {
    seedCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'existing_rt' });
    const state = await getValidState();
    // Google returns only an access_token – no new refresh_token.
    mockGetToken.mockResolvedValueOnce({ tokens: { access_token: 'at' } });

    const res = await ctx.request
      .get(`/api/google-drive/callback?code=authcode&state=${encodeURIComponent(state)}`)
      .expect(200);

    expect(res.text).toContain('drive-auth-success');
    // Existing refresh token must be preserved.
    const row = db.prepare("SELECT credentials FROM api_credentials WHERE service='google_drive'").get();
    expect(JSON.parse(row.credentials).refresh_token).toBe('existing_rt');
  });

  it('returns error postMessage when no refresh_token returned and none stored', async () => {
    // beforeEach already seeds with no refresh_token – no extra setup needed.
    const state = await getValidState();
    mockGetToken.mockResolvedValueOnce({ tokens: { access_token: 'at' } }); // no refresh_token

    const res = await ctx.request
      .get(`/api/google-drive/callback?code=authcode&state=${encodeURIComponent(state)}`)
      .expect(200);

    expect(res.text).toContain('drive-auth-error');
    expect(res.text).toContain('refresh token');
  });

  it('returns error postMessage when token exchange throws', async () => {
    const state = await getValidState();
    mockGetToken.mockRejectedValueOnce(new Error('invalid_grant'));

    const res = await ctx.request
      .get(`/api/google-drive/callback?code=badcode&state=${encodeURIComponent(state)}`)
      .expect(200);

    expect(res.text).toContain('drive-auth-error');
    expect(res.text).toContain('invalid_grant');
  });

  it('rejects reuse of a state token (each token is one-time use)', async () => {
    const state = await getValidState();
    mockGetToken.mockResolvedValue({ tokens: { refresh_token: 'rt' } });

    // First use – valid.
    await ctx.request
      .get(`/api/google-drive/callback?code=c1&state=${encodeURIComponent(state)}`)
      .expect(200);

    // Second use of the same state – must be rejected as the token is consumed.
    const res2 = await ctx.request
      .get(`/api/google-drive/callback?code=c2&state=${encodeURIComponent(state)}`)
      .expect(200);

    expect(res2.text).toContain('drive-auth-error');
    expect(res2.text).toContain('state');
  });

  it('returns error postMessage when OAuth2 credentials are not configured', async () => {
    // Temporarily seed valid creds to register a valid state via /auth-url,
    // then remove the credentials before calling the callback.
    seedCreds({ client_id: 'cid', client_secret: 'cs' });
    const state = await getValidState();
    seedCreds({ client_id: '', client_secret: '' }); // remove credentials

    const res = await ctx.request
      .get(`/api/google-drive/callback?code=c1&state=${encodeURIComponent(state)}`)
      .expect(200);

    expect(res.text).toContain('drive-auth-error');
    expect(res.text).toContain('credentials not configured');
  });
});

// ─── GET /api/google-drive/token ─────────────────────────────────────────────
describe('GET /api/google-drive/token', () => {
  it('returns accessToken and apiKey when authenticated and token is fresh', async () => {
    seedCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt', api_key: 'mykey' });
    mockGetAccessToken.mockResolvedValueOnce({ token: 'fresh_access_token' });

    const res = await ctx.request.get('/api/google-drive/token').expect(200);
    expect(res.body.accessToken).toBe('fresh_access_token');
    expect(res.body.apiKey).toBe('mykey');
  });

  it('returns empty string for apiKey when not configured', async () => {
    seedCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' });
    mockGetAccessToken.mockResolvedValueOnce({ token: 'token' });

    const res = await ctx.request.get('/api/google-drive/token').expect(200);
    expect(res.body.apiKey).toBe('');
  });

  it('returns 401 when getAccessToken resolves with null token', async () => {
    seedCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' });
    mockGetAccessToken.mockResolvedValueOnce({ token: null });

    const res = await ctx.request.get('/api/google-drive/token').expect(401);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 401 when getAccessToken throws', async () => {
    seedCreds({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' });
    mockGetAccessToken.mockRejectedValueOnce(new Error('Token expired'));

    const res = await ctx.request.get('/api/google-drive/token').expect(401);
    expect(res.body.error).toMatch(/Token expired/);
  });

  it('returns 401 when not authenticated', async () => {
    // beforeEach seeds creds without refresh_token.
    const res = await ctx.request.get('/api/google-drive/token').expect(401);
    expect(res.body.error).toBeTruthy();
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });
});
