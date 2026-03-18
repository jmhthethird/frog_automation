'use strict';

const https = require('https');
const http = require('http');
const { db } = require('./db');

/**
 * Get all registered webhooks for a specific event type.
 *
 * @param {string} eventType - Event type (e.g., 'upload.success', 'upload.failure')
 * @returns {Array<{id: number, url: string, event_type: string, enabled: number}>}
 */
function getWebhooksForEvent(eventType) {
  const webhooks = db.prepare(`
    SELECT id, url, event_type, enabled
    FROM webhooks
    WHERE event_type = ? AND enabled = 1
  `).all(eventType);

  return webhooks || [];
}

/**
 * Send a webhook notification to a URL.
 *
 * @param {string} url - Webhook URL
 * @param {object} payload - JSON payload to send
 * @returns {Promise<{success: boolean, statusCode?: number, error?: string}>}
 */
async function sendWebhook(url, payload) {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const postData = JSON.stringify(payload);

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Frog-Automation-Webhook/1.0',
        },
        timeout: 10000, // 10 second timeout
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, statusCode: res.statusCode });
          } else {
            resolve({ success: false, statusCode: res.statusCode, error: `HTTP ${res.statusCode}` });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Request timeout' });
      });

      req.write(postData);
      req.end();
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

/**
 * Trigger webhooks for an event.
 *
 * @param {string} eventType - Event type (e.g., 'upload.success', 'upload.failure')
 * @param {object} payload - Event payload
 * @returns {Promise<Array<{webhookId: number, url: string, success: boolean, error?: string}>>}
 */
async function triggerWebhooks(eventType, payload) {
  const webhooks = getWebhooksForEvent(eventType);
  const results = [];

  // Add standard fields to payload
  const fullPayload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  // Send webhooks in parallel
  const promises = webhooks.map(async (webhook) => {
    const result = await sendWebhook(webhook.url, fullPayload);
    console.log(`[webhook] ${eventType} → ${webhook.url}: ${result.success ? 'success' : result.error}`);
    return {
      webhookId: webhook.id,
      url: webhook.url,
      ...result,
    };
  });

  return Promise.all(promises);
}

/**
 * Trigger upload success webhooks.
 *
 * @param {object} data
 * @param {number} data.jobId - Job ID
 * @param {string} data.fileId - Google Drive file ID
 * @param {string} data.domain - Domain name
 * @param {number} data.size - File size in bytes
 */
async function notifyUploadSuccess(data) {
  return triggerWebhooks('upload.success', data);
}

/**
 * Trigger upload failure webhooks.
 *
 * @param {object} data
 * @param {number} data.jobId - Job ID
 * @param {string} data.error - Error message
 */
async function notifyUploadFailure(data) {
  return triggerWebhooks('upload.failure', data);
}

module.exports = {
  getWebhooksForEvent,
  sendWebhook,
  triggerWebhooks,
  notifyUploadSuccess,
  notifyUploadFailure,
};
