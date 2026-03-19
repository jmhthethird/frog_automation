'use strict';

const { sendWebhook } = require('../../src/webhook');
const http  = require('http');

// ─── sendWebhook() ────────────────────────────────────────────────────────────
describe('sendWebhook()', () => {
  let server;
  let serverUrl;
  let lastRequest; // { method, headers, body }

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        lastRequest = { method: req.method, headers: req.headers, body: raw };
        res.writeHead(200);
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      serverUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(() => { lastRequest = null; });

  it('sends a POST request with JSON content-type', async () => {
    await sendWebhook(serverUrl, { event: 'test' });
    expect(lastRequest.method).toBe('POST');
    expect(lastRequest.headers['content-type']).toBe('application/json');
  });

  it('sends the payload as JSON', async () => {
    const payload = { event: 'drive_upload_complete', jobId: 42, domain: 'example.com' };
    await sendWebhook(serverUrl, payload);
    expect(JSON.parse(lastRequest.body)).toEqual(payload);
  });

  it('resolves with the response status code', async () => {
    const result = await sendWebhook(serverUrl, {});
    expect(result.statusCode).toBe(200);
  });

  it('rejects when the URL is invalid', async () => {
    await expect(sendWebhook('not-a-url', {})).rejects.toThrow(/Invalid webhook URL/i);
  });

  it('rejects when the URL uses an unsupported protocol', async () => {
    await expect(sendWebhook('ftp://example.com', {})).rejects.toThrow(/http or https/i);
  });

  it('rejects when the server is unreachable', async () => {
    // Port 1 is almost never open locally.
    await expect(sendWebhook('http://127.0.0.1:1/hook', {})).rejects.toThrow();
  });
});
