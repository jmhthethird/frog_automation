'use strict';

/**
 * test-site.js
 *
 * A tiny multi-page HTTP server used in the Screaming Frog integration tests.
 *
 * Routes:
 *   GET /            → 200 HTML, links to /page1, /page2, /redirect, /missing
 *   GET /page1       → 200 HTML
 *   GET /page2       → 200 HTML
 *   GET /redirect    → 301 → /page1
 *   GET /missing     → 404
 *   anything else    → 404
 *
 * Returns: { url, stop }
 */

const http = require('http');

const PAGES = {
  '/': `<!DOCTYPE html>
<html><head><title>Test Home</title></head>
<body>
  <h1>Home Page</h1>
  <a href="/page1">Page 1</a>
  <a href="/page2">Page 2</a>
  <a href="/redirect">Redirect</a>
  <a href="/missing">Missing</a>
</body></html>`,

  '/page1': `<!DOCTYPE html>
<html><head><title>Page 1</title></head>
<body><h1>Page 1</h1><a href="/">Back home</a></body></html>`,

  '/page2': `<!DOCTYPE html>
<html><head><title>Page 2</title></head>
<body><h1>Page 2</h1><a href="/">Back home</a></body></html>`,
};

/**
 * Start the test site.
 * @returns {Promise<{ url: string, stop: () => Promise<void> }>}
 */
function createTestSite() {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(301, { Location: '/page1' });
      return res.end();
    }
    if (PAGES[req.url]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGES[req.url]);
    }
    // 404
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>Not Found</h1></body></html>');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        stop: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

module.exports = { createTestSite };
