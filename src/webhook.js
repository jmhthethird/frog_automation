'use strict';

/**
 * Lightweight webhook dispatcher.
 *
 * Sends a JSON POST request to the configured URL when a Google Drive upload
 * completes.  The request times out after 10 seconds; any network error is
 * returned as a rejected Promise so the caller can decide whether to log or
 * swallow it.
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * POST a JSON payload to webhookUrl.
 *
 * @param {string} webhookUrl   - The HTTP/HTTPS endpoint to notify.
 * @param {object} payload      - Data to send as JSON.
 * @returns {Promise<{ statusCode: number }>}
 */
function sendWebhook(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch (err) {
      return reject(new Error(`Invalid webhook URL: ${err.message}`));
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return reject(new Error(`Webhook URL must use http or https (got ${parsedUrl.protocol})`));
    }

    const body = JSON.stringify(payload);
    const options = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'FrogAutomation-Webhook/1.0',
      },
    };

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      resolve({ statusCode: res.statusCode });
      res.resume(); // drain to allow the socket to close
    });

    req.setTimeout(WEBHOOK_TIMEOUT_MS, () => {
      req.destroy(new Error(`Webhook request timed out after ${WEBHOOK_TIMEOUT_MS / 1_000} s`));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { sendWebhook };
