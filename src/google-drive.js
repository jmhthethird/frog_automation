'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

/**
 * Build an authenticated Drive v3 client from a service account JSON key.
 * The key may be passed as a JSON string or as a plain object.
 *
 * @param {string|object} serviceAccountKey - Service account credentials JSON.
 * @returns {import('googleapis').drive_v3.Drive}
 */
function buildDriveClientFromApiKey(serviceAccountKey) {
  let keyObj;
  try {
    keyObj = typeof serviceAccountKey === 'string'
      ? JSON.parse(serviceAccountKey)
      : serviceAccountKey;
  } catch {
    throw new SyntaxError('Invalid service account key: must be valid JSON');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: keyObj,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

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
 * Upload a crawl ZIP to Google Drive using a service account API key.
 *
 * Folder structure created/verified on Drive:
 *
 *   My Drive (service account)
 *     └── [user-specified root folder]   ← rootFolderId entered in settings
 *           └── <domain>/               ← derived from jobUrl; created if absent
 *                 └── <filename.zip>
 *
 * After uploading, a post-upload size validation is performed: the file size
 * reported by Drive is compared against the local file size.  A mismatch
 * throws an error.
 *
 * @param {object} options
 * @param {string}  options.apiKey        - Service account JSON key (string or object).
 * @param {string}  options.filePath      - Absolute path to the local ZIP file.
 * @param {string}  options.jobUrl        - Crawled URL (used to derive the domain folder name).
 * @param {string} [options.rootFolderId] - Drive folder ID. When absent the domain folder
 *   is placed directly in the service account's My Drive root.
 * @returns {Promise<{ fileId: string, domain: string, folderId: string, localSize: number, driveSize: number }>}
 */
async function uploadToDrive({ apiKey, filePath, jobUrl, rootFolderId }) {
  const drive = buildDriveClientFromApiKey(apiKey);

  const domain = domainFromUrl(jobUrl);
  const filename = path.basename(filePath);

  // Ensure the per-domain subfolder exists inside the user-selected root folder.
  const folderId = await ensureFolder(drive, domain, rootFolderId || null);

  const localSize = fs.statSync(filePath).size;
  const fileStream = fs.createReadStream(filePath);

  const uploadResp = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: 'application/zip', body: fileStream },
    fields: 'id, size',
  });

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

module.exports = { uploadToDrive, buildDriveClientFromApiKey, ensureFolder, findFolder, domainFromUrl };
