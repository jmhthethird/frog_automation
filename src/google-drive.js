'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { DRIVE_CATEGORIES } = require('./constants/driveCategories');

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
 * Upload a single file to Google Drive.
 *
 * @param {import('googleapis').drive_v3.Drive} drive - Authenticated Drive client.
 * @param {string} filePath - Absolute path to the local file.
 * @param {string} parentId - Drive folder ID to upload into.
 * @param {string} [fileName] - Override file name (defaults to basename of filePath).
 * @returns {Promise<{ fileId: string, localSize: number, driveSize: number }>}
 */
async function uploadFile(drive, filePath, parentId, fileName) {
  const name = fileName || path.basename(filePath);
  const localSize = fs.statSync(filePath).size;
  const fileStream = fs.createReadStream(filePath);

  let uploadResp;
  try {
    uploadResp = await drive.files.create({
      requestBody: { name, parents: [parentId] },
      media: { body: fileStream },
      fields: 'id, size',
    });
  } finally {
    fileStream.on('error', () => {});
    fileStream.destroy();
  }

  const fileId = uploadResp.data.id;
  const driveSize = parseInt(uploadResp.data.size, 10);

  if (driveSize !== localSize) {
    throw new Error(
      `Google Drive upload validation failed for "${name}": ` +
      `local size ${localSize} bytes ≠ Drive size ${driveSize} bytes`
    );
  }

  return { fileId, localSize, driveSize };
}

/**
 * Recursively upload a local directory to Google Drive.
 *
 * @param {import('googleapis').drive_v3.Drive} drive - Authenticated Drive client.
 * @param {string} localDir - Absolute path to the local directory.
 * @param {string} parentId - Drive folder ID to upload into.
 * @param {string} [folderName] - Name for the folder on Drive (defaults to basename of localDir).
 * @returns {Promise<{ folderId: string, fileCount: number, totalSize: number }>}
 */
async function uploadFolder(drive, localDir, parentId, folderName) {
  const name = folderName || path.basename(localDir);
  const folderId = await ensureFolder(drive, name, parentId);

  let fileCount = 0;
  let totalSize = 0;

  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(localDir, entry.name);
    if (entry.isDirectory()) {
      const sub = await uploadFolder(drive, entryPath, folderId);
      fileCount += sub.fileCount;
      totalSize += sub.totalSize;
    } else if (entry.isFile()) {
      const result = await uploadFile(drive, entryPath, folderId);
      fileCount += 1;
      totalSize += result.localSize;
    }
  }

  return { folderId, fileCount, totalSize };
}

/**
 * Upload output to Google Drive (both ZIP and folder).
 *
 * Folder structure created/verified on Drive:
 *
 *   My Drive
 *     └── [user-selected root folder]   ← rootFolderId from the folder picker
 *           └── <category>/             ← e.g. "Crawls", "Reports", "Automation", "Templates"
 *                 └── <domain>/         ← derived from jobUrl (omitted when useDomainSubfolder is false)
 *                       ├── <jobLabel>/       ← unzipped folder with all files
 *                       └── <jobLabel>.zip    ← the ZIP archive
 *
 * The `driveCategory` parameter determines the top-level subfolder under the
 * root folder.  Pass one of the constants from `src/constants/driveCategories.js`
 * (e.g. `DRIVE_CATEGORIES.CRAWLS`, `.REPORTS`, `.AUTOMATION`, `.TEMPLATES`).
 *
 * Each category constant is an object `{ folder, useDomainSubfolder }`.
 * When `useDomainSubfolder` is true (Crawls, Reports, Automation) a
 * per-domain folder is created inside the category folder.  When false
 * (Templates) files are placed directly inside the category folder.
 *
 * After uploading each file, a post-upload size validation is performed: the
 * file size reported by Drive is compared against the local file size.
 * A mismatch throws an error.
 *
 * @param {object} options
 * @param {string}  options.clientId       - OAuth2 Client ID.
 * @param {string}  options.clientSecret   - OAuth2 Client Secret.
 * @param {string}  options.refreshToken   - Stored OAuth2 refresh token.
 * @param {string}  options.filePath       - Absolute path to the local ZIP file.
 * @param {string}  options.outputDir      - Absolute path to the local output directory (unzipped).
 * @param {string}  options.jobLabel       - The job label (e.g., "google_2026-03-11_06-23PM-job25").
 * @param {string}  options.jobUrl         - Crawled URL (used to derive the domain folder name).
 * @param {string} [options.rootFolderId]  - Drive folder ID selected via the folder picker.
 *   When absent the category folder is placed directly in My Drive root.
 * @param {object} [options.driveCategory] - Category descriptor from DRIVE_CATEGORIES.
 *   Defaults to `DRIVE_CATEGORIES.CRAWLS`.
 * @returns {Promise<{ fileId: string, domain: string, folderId: string, localSize: number, driveSize: number, folderResult: { folderId: string, fileCount: number, totalSize: number } }>}
 */
async function uploadToDrive({ clientId, clientSecret, refreshToken, filePath, outputDir, jobLabel, jobUrl, rootFolderId, driveCategory }) {
  const drive = buildDriveClientFromOAuth(clientId, clientSecret, refreshToken);

  const category = driveCategory || DRIVE_CATEGORIES.CRAWLS;
  const domain = domainFromUrl(jobUrl);

  // Ensure the category folder exists inside the user-selected root folder.
  const categoryFolderId = await ensureFolder(drive, category.folder, rootFolderId || null);

  // When the category uses per-domain subfolders, create one; otherwise
  // upload directly into the category folder.
  let targetFolderId;
  if (category.useDomainSubfolder) {
    targetFolderId = await ensureFolder(drive, domain, categoryFolderId);
  } else {
    targetFolderId = categoryFolderId;
  }

  // Upload the unzipped folder first
  let folderResult = null;
  if (outputDir && fs.existsSync(outputDir)) {
    folderResult = await uploadFolder(drive, outputDir, targetFolderId, jobLabel);
  }

  // Upload the ZIP file with the proper job label name
  const zipFileName = jobLabel ? `${jobLabel}.zip` : path.basename(filePath);
  const { fileId, localSize, driveSize } = await uploadFile(drive, filePath, targetFolderId, zipFileName);

  return { fileId, domain, folderId: targetFolderId, localSize, driveSize, folderResult };
}

/** Regex for valid Google Drive folder IDs (alphanumeric, underscores, hyphens). */
const DRIVE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * List all immediate subfolders inside a parent folder on Google Drive.
 *
 * @param {import('googleapis').drive_v3.Drive} drive
 * @param {string|null} parentId - Parent folder ID, or null for Drive root.
 *   Must match the pattern `/^[a-zA-Z0-9_-]{1,128}$/` when provided;
 *   invalid values are treated as null (Drive root).
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
async function listSubfolders(drive, parentId) {
  // Validate parentId — fall back to Drive root if the value is invalid.
  const safeParentId = (parentId && DRIVE_ID_RE.test(parentId)) ? parentId : null;
  const inParent = safeParentId ? `'${safeParentId}' in parents` : "'root' in parents";
  const q = `mimeType='application/vnd.google-apps.folder' and ${inParent} and trashed=false`;

  const folders = [];
  let pageToken;
  do {
    const resp = await drive.files.list({
      q,
      fields: 'nextPageToken, files(id, name)',
      spaces: 'drive',
      pageSize: 200,
      ...(pageToken ? { pageToken } : {}),
    });
    folders.push(...(resp.data.files || []));
    pageToken = resp.data.nextPageToken;
  } while (pageToken);

  return folders;
}

/**
 * Migrate existing Google Drive folder structure to the new category-based layout.
 *
 * Before this feature, crawl artefacts were placed directly under the root
 * folder organised by domain:
 *
 *   [Root Folder]
 *     └── <domain>/          ← old layout
 *
 * The new layout adds a category tier:
 *
 *   [Root Folder]
 *     └── Crawls/
 *           └── <domain>/    ← new layout
 *
 * This function:
 * 1. Lists all subfolders in the root folder.
 * 2. Filters out any that are already known category folders (Crawls, Reports,
 *    Automation, Templates).
 * 3. Ensures the "Crawls" category folder exists.
 * 4. Moves every remaining folder into "Crawls" via the Drive API
 *    `files.update` (addParents / removeParents).
 *
 * The operation is idempotent: running it again after a successful migration
 * is a no-op because the domain folders are already inside "Crawls".
 *
 * @param {object} options
 * @param {string}  options.clientId      - OAuth2 Client ID.
 * @param {string}  options.clientSecret  - OAuth2 Client Secret.
 * @param {string}  options.refreshToken  - OAuth2 refresh token.
 * @param {string} [options.rootFolderId] - Root folder ID (null → Drive root).
 * @returns {Promise<{ migrated: number, skipped: string[], crawlsFolderId: string }>}
 */
async function migrateDriveFolders({ clientId, clientSecret, refreshToken, rootFolderId }) {
  const drive = buildDriveClientFromOAuth(clientId, clientSecret, refreshToken);

  const categoryNames = new Set(
    Object.values(DRIVE_CATEGORIES).map(c => c.folder)
  );

  // List every immediate subfolder in the root folder.
  const rootChildren = await listSubfolders(drive, rootFolderId || null);

  // A domain-like name: one or more labels separated by dots, ending with a
  // TLD of at least two characters.  This deliberately avoids moving unrelated
  // user folders (e.g. "Invoices", "SEO Assets") that happen to live in the
  // root folder — only folders whose name looks like a hostname are migrated.
  const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;

  // Separate category folders from legacy domain folders.
  const skipped = [];
  const toMigrate = [];
  for (const child of rootChildren) {
    if (categoryNames.has(child.name)) {
      skipped.push(child.name);
    } else if (DOMAIN_RE.test(child.name)) {
      toMigrate.push(child);
    } else {
      // Non-category, non-domain folder — skip silently (e.g. user's own folders).
      skipped.push(child.name);
    }
  }

  // Ensure the "Crawls" folder exists.
  const crawlsFolderId = await ensureFolder(drive, DRIVE_CATEGORIES.CRAWLS.folder, rootFolderId || null);

  // Move each legacy domain folder into the Crawls folder.
  for (const folder of toMigrate) {
    const previousParent = rootFolderId || 'root';
    await drive.files.update({
      fileId: folder.id,
      addParents: crawlsFolderId,
      removeParents: previousParent,
      fields: 'id, parents',
    });
  }

  return { migrated: toMigrate.length, skipped, crawlsFolderId };
}

module.exports = { uploadToDrive, uploadFolder, uploadFile, buildOAuth2Client, buildDriveClientFromOAuth, ensureFolder, findFolder, domainFromUrl, listSubfolders, migrateDriveFolders };
