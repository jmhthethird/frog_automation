'use strict';

/**
 * Extract the registrable domain segment from a URL.
 * e.g., "https://wwe.google.com" → "google"
 *       "https://example.co.uk"  → "example" (best-effort for simple TLDs)
 */
function extractDomain(url) {
  try {
    const parts = new URL(url).hostname.split('.');
    const raw = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return raw.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Build a job label string suitable for use in file and folder names.
 * Format: {domain}_{YYYY-MM-DD}_{HH-MM[AM|PM]}-job{id}
 * Example: "google_2025-03-10_03-14PM-job13"
 *
 * @param {string} url         - The crawled URL.
 * @param {string|null} completedAt - SQLite datetime string (YYYY-MM-DD HH:MM:SS) or null.
 * @param {number} jobId       - The job ID.
 * @returns {string}
 */
function buildJobLabel(url, completedAt, jobId) {
  const domain = extractDomain(url);
  // SQLite datetime strings are stored without timezone info but are always UTC
  // (produced by datetime('now')). Appending 'Z' makes JS treat them correctly.
  const d = completedAt ? new Date(completedAt + 'Z') : new Date();
  const date = d.toISOString().slice(0, 10); // YYYY-MM-DD
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = `${String(h).padStart(2, '0')}-${String(m).padStart(2, '0')}${ampm}`;
  return `${domain}_${date}_${time}-job${jobId}`;
}

module.exports = { extractDomain, buildJobLabel };
