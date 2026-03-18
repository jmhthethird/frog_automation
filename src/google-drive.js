'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

/**
 * Build an OAuth2 client.
 *
 * redirectUri is only required during the initial authorization-code exchange.
 * When the client is used solely for refreshing tokens it may be omitted.
 *
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {string} [redirectUri]
 * @returns {import('google-auth-library').OAuth2Client}
 */
function buildOAuth2Client(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Build an authenticated Drive v3 client using a stored OAuth2 refresh token.
 * googleapis automatically refreshes the access token when it expires.
 *
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {string} refreshToken
 * @returns {import('googleapis').drive_v3.Drive}
 */
function buildDriveClientFromOAuth(clientId, clientSecret, refreshToken) {
  const auth = buildOAuth2Client(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth });
}

/**
 * Find a folder by name within a given parent folder (or Drive root).
 * Returns the folder's ID, or null when not found.
 *
 * @param {import('googleapis').drive_v3.Drive} drive
 * @param {string} name
 * @param {string|null} parentId - Parent folder ID, or null for My Drive root.
 * @returns {Promise<string|null>}
 */
async function findFolder(drive, name, parentId) {
  const inParent = parentId ? `'${parentId}' in parents` : "'root' in parents";
  // Escape backslashes and single quotes for the GDQL query string.
  const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and ${inParent} and trashed=false`;

  const resp = await drive.files.list({
    q,
    fields: 'files(id, name)',
    spaces: 'drive',
    pageSize: 1,
  });

  const files = resp.data.files || [];
  return files.length > 0 ? files[0].id : null;
}

/**
 * Get or create a single folder by name inside a given parent (or Drive root).
 * Returns the folder's ID.
 *
 * @param {import('googleapis').drive_v3.Drive} drive
 * @param {string} name
 * @param {string|null} parentId
 * @returns {Promise<string>}
 */
async function ensureFolder(drive, name, parentId) {
  const existing = await findFolder(drive, name, parentId);
  if (existing) return existing;

  const meta = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId ? { parents: [parentId] } : {}),
  };

  const resp = await drive.files.create({ requestBody: meta, fields: 'id' });
  return resp.data.id;
}

/**
 * Extract the hostname from a URL for use as a Drive folder name, stripping
 * a leading "www." prefix so all crawls for a domain are grouped together.
 *
 * e.g. "https://www.example.com/path" → "example.com"
 *
 * @param {string} url
 * @returns {string}
 */
function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Upload a crawl ZIP to Google Drive.
 *
 * Folder structure created/verified on Drive:
 *
 *   My Drive
 *     └── [user-selected root folder]   ← rootFolderId from the folder picker
 *           └── <domain>/               ← derived from jobUrl; created if absent
 *                 └── <filename.zip>
 *
 * After uploading, a post-upload size validation is performed: the file size
 * reported by Drive is compared against the local file size.  A mismatch
 * throws an error.
 *
 * @param {object} options
 * @param {string}  options.clientId      - OAuth2 Client ID.
 * @param {string}  options.clientSecret  - OAuth2 Client Secret.
 * @param {string}  options.refreshToken  - Stored OAuth2 refresh token.
 * @param {string}  options.filePath      - Absolute path to the local ZIP file.
 * @param {string}  options.jobUrl        - Crawled URL (used to derive the domain folder name).
 * @param {string} [options.rootFolderId] - Drive folder ID selected via the folder picker.
 *   When absent the domain folder is placed directly in My Drive root.
 * @param {Function} [options.onProgress] - Optional progress callback: ({ bytesUploaded, totalBytes, percentage }) => void
 * @returns {Promise<{ fileId: string, domain: string, folderId: string, localSize: number, driveSize: number }>}
 */
async function uploadToDrive({ clientId, clientSecret, refreshToken, filePath, jobUrl, rootFolderId, onProgress }) {
  const drive = buildDriveClientFromOAuth(clientId, clientSecret, refreshToken);

  const domain = domainFromUrl(jobUrl);
  const filename = path.basename(filePath);

  // Ensure the per-domain subfolder exists inside the user-selected root folder.
  const folderId = await ensureFolder(drive, domain, rootFolderId || null);

  const localSize = fs.statSync(filePath).size;
  const fileStream = fs.createReadStream(filePath);

  // Track upload progress if callback provided
  let bytesUploaded = 0;
  if (onProgress && typeof onProgress === 'function') {
    fileStream.on('data', (chunk) => {
      bytesUploaded += chunk.length;
      const percentage = Math.min(100, Math.round((bytesUploaded / localSize) * 100));
      onProgress({ bytesUploaded, totalBytes: localSize, percentage });
    });
  }

  let uploadResp;
  try {
    uploadResp = await drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType: 'application/zip', body: fileStream },
      fields: 'id, size',
    });
  } finally {
    // Suppress any error event that may fire after the stream is destroyed
    // (e.g. the autoOpen callback completing after the file was removed in
    // tests, or a late close error). Errors that occur during the upload are
    // already surfaced via the rejected drive.files.create promise.
    fileStream.on('error', () => {});
    fileStream.destroy();
  }

  const fileId = uploadResp.data.id;
  const driveSize = parseInt(uploadResp.data.size, 10);

  // ── Post-upload validation ────────────────────────────────────────────────
  if (driveSize !== localSize) {
    throw new Error(
      `Google Drive upload validation failed for "${filename}": ` +
      `local size ${localSize} bytes ≠ Drive size ${driveSize} bytes`
    );
  }

  return { fileId, domain, folderId, localSize, driveSize };
}

module.exports = { uploadToDrive, buildOAuth2Client, buildDriveClientFromOAuth, ensureFolder, findFolder, domainFromUrl };
