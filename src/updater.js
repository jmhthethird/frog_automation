'use strict';

/**
 * updater.js — self-update logic for Frog Automation.
 *
 * Responsibilities:
 *   1. checkForUpdate()  — queries the GitHub Releases API and compares versions.
 *   2. downloadUpdate()  — streams the release asset (DMG) to a temp file with
 *                          progress tracking.
 *   3. installUpdate()   — mounts the DMG, copies the new .app bundle to the
 *                          location of the currently-running bundle, unmounts,
 *                          and restarts the app.  macOS only.
 *   4. getState()        — returns a snapshot of the current update state.
 */

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const cp     = require('child_process');

const GITHUB_OWNER    = 'jmhthethird';
const GITHUB_REPO     = 'frog_automation';
/** Milliseconds to wait after resolving installUpdate() before restarting,
 *  giving the HTTP response time to reach the client. */
const RESTART_DELAY_MS = 800;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read the current application version from package.json. */
function getCurrentVersion() {
  return require('../package.json').version;
}

/**
 * Strict semver comparison (major.minor.patch, strips leading "v").
 * Returns true if version string b is strictly greater than a.
 */
function isNewer(a, b) {
  const parse = v => v.replace(/^v/, '').split('.').map(Number);
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((bv[i] || 0) !== (av[i] || 0)) return (bv[i] || 0) > (av[i] || 0);
  }
  return false;
}

/**
 * Derive the .app bundle path from process.execPath when running in Electron.
 * e.g. /Applications/Frog Automation.app/Contents/MacOS/Frog Automation
 *      → /Applications/Frog Automation.app
 */
function getAppBundlePath() {
  const m = process.execPath.match(/^(.*?\.app)\//);
  return m ? m[1] : null;
}

// ── State ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {'idle'|'checking'|'up-to-date'|'available'|'downloading'|'ready'|'installing'|'error'} UpdateStatus
 *
 * @typedef {Object} UpdateState
 * @property {UpdateStatus} status
 * @property {string}       currentVersion
 * @property {string|null}  latestVersion
 * @property {string|null}  releaseUrl
 * @property {string|null}  releaseNotes
 * @property {string|null}  downloadUrl
 * @property {string|null}  downloadPath
 * @property {number}       progress        0–100
 * @property {string|null}  error
 * @property {boolean}      isPrivateRepo   true when a GitHub PAT is active
 *
 * @typedef {Object} ReleaseInfo
 * @property {string}      version
 * @property {string}      tag
 * @property {string|null} releaseUrl
 * @property {string|null} releaseNotes
 * @property {string|null} downloadUrl
 * @property {string|null} publishedAt
 */

const _state = {
  status:        'idle',
  latestVersion: null,
  releaseUrl:    null,
  releaseNotes:  null,
  downloadUrl:   null,
  downloadPath:  null,
  progress:      0,
  error:         null,
};

function _patch(obj) { Object.assign(_state, obj); }

/** @returns {UpdateState} */
function getState() {
  return { ..._state, currentVersion: getCurrentVersion(), isPrivateRepo: !!_getGithubPat() };
}

// ── listAllReleases ───────────────────────────────────────────────────────────

/**
 * Fetch all GitHub releases and return them enriched with a per-arch download URL.
 * Never rejects — returns an empty array on error.
 *
 * @returns {Promise<ReleaseInfo[]>}
 */
async function listAllReleases() {
  let releases;
  const token = _getGithubPat();
  try {
    releases = await _fetchJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      token
    );
  } catch {
    return [];
  }
  if (!Array.isArray(releases)) return [];

  const arch = process.arch;
  return releases
    .map(release => {
      const version = (release.tag_name || '').replace(/^v/, '');
      if (!version) return null;
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const asset  = arch === 'arm64'
        ? assets.find(a => a.name.endsWith('-arm64.dmg'))
        : assets.find(a => a.name.endsWith('.dmg') && !a.name.includes('arm64'));
      return {
        version,
        tag:          release.tag_name     || '',
        releaseUrl:   release.html_url      || null,
        releaseNotes: release.body          || null,
        downloadUrl:  asset ? asset.browser_download_url : null,
        publishedAt:  release.published_at  || null,
      };
    })
    .filter(Boolean);
}

// ── selectVersionForInstall ───────────────────────────────────────────────────

/**
 * Set a specific version as the installation target, regardless of whether it
 * is newer or older than the currently-running version.  Places the updater
 * into the 'available' state so the existing download / install flow can
 * proceed unchanged.
 *
 * @param {string}      version
 * @param {string|null} downloadUrl
 * @param {string|null} releaseUrl
 * @param {string|null} releaseNotes
 */
function selectVersionForInstall(version, downloadUrl, releaseUrl, releaseNotes) {
  _patch({
    status:        'available',
    latestVersion: version,
    downloadUrl:   downloadUrl  || null,
    releaseUrl:    releaseUrl   || null,
    releaseNotes:  releaseNotes || null,
    downloadPath:  null,
    progress:      0,
    error:         null,
  });
}

// ── checkForUpdate ────────────────────────────────────────────────────────────

/**
 * Query the GitHub Releases API and compare with the current version.
 * Updates internal state and resolves with the current state.
 * Never rejects — errors are captured in state.error.
 *
 * @returns {Promise<UpdateState>}
 */
async function checkForUpdate() {
  _patch({ status: 'checking', error: null });

  const token = _getGithubPat();
  let release;
  try {
    release = await _fetchJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      token
    );
  } catch (err) {
    _patch({ status: 'error', error: err.message });
    return getState();
  }

  const latestVersion = (release.tag_name || '').replace(/^v/, '');
  if (!latestVersion) {
    _patch({ status: 'error', error: 'Unexpected GitHub API response' });
    return getState();
  }

  _patch({ latestVersion, releaseUrl: release.html_url || null, releaseNotes: release.body || null });

  const current = getCurrentVersion();
  if (!isNewer(current, latestVersion)) {
    _patch({ status: 'up-to-date' });
    return getState();
  }

  // Find the right DMG asset for the current architecture.
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const arch   = process.arch; // 'arm64' or 'x64'
  const asset  = arch === 'arm64'
    ? assets.find(a => a.name.endsWith('-arm64.dmg'))
    : assets.find(a => a.name.endsWith('.dmg') && !a.name.includes('arm64'));

  _patch({
    status:      'available',
    downloadUrl: asset ? asset.browser_download_url : null,
  });
  return getState();
}

// ── downloadUpdate ────────────────────────────────────────────────────────────

/**
 * Stream the release DMG to a temp file, tracking progress.
 * Resolves with the local file path on success.
 *
 * @param {string} url  Must be a github.com or githubusercontent.com URL.
 * @returns {Promise<string>}
 */
function downloadUpdate(url) {
  if (_state.status === 'downloading') {
    return Promise.reject(new Error('Download already in progress'));
  }

  // Security: only allow GitHub-hosted assets.
  let parsed;
  try { parsed = new URL(url); } catch { return Promise.reject(new Error('Invalid download URL')); }
  const allowedHosts = [
    'github.com',
    'objects.githubusercontent.com',
    'github-releases.githubusercontent.com',
  ];
  if (!allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
    return Promise.reject(new Error('Download URL must be from github.com'));
  }

  _patch({ status: 'downloading', progress: 0, downloadPath: null, error: null });

  // Private-repo assets require authentication on the initial request to
  // github.com.  The redirect target (e.g. objects.githubusercontent.com) uses
  // a signed URL and must NOT receive the token — the hostname check inside
  // get() ensures the PAT is only attached to github.com requests.
  const token = _getGithubPat();

  return new Promise((resolve, reject) => {
    const filename = parsed.pathname.split('/').pop() || 'update.dmg';
    const destPath = path.join(os.tmpdir(), `frog-update-${filename}`);

    let redirected = false;

    function get(u) {
      let reqParsed;
      try { reqParsed = new URL(u); } catch {
        const err = new Error('Invalid redirect URL');
        _patch({ status: 'error', error: err.message });
        reject(err);
        return;
      }

      // Enforce HTTPS on every hop.
      if (reqParsed.protocol !== 'https:') {
        const err = new Error('Download URL must use HTTPS');
        _patch({ status: 'error', error: err.message });
        reject(err);
        return;
      }

      const headers = { 'User-Agent': `FrogAutomation/${getCurrentVersion()}` };
      // Only attach the PAT on the initial request to the GitHub host itself.
      // CDN redirects (objects.githubusercontent.com) use signed URLs and must
      // NOT receive the token.
      if (token && reqParsed.hostname === 'github.com') {
        headers['Authorization'] = `Bearer ${token}`;
        headers['Accept'] = 'application/octet-stream';
      }
      https.get(reqParsed, { headers }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (redirected) {
            const err = new Error('Too many redirects');
            _patch({ status: 'error', error: err.message });
            reject(err);
            return;
          }
          const location = res.headers.location;
          if (!location) {
            const err = new Error('Redirect with no Location header');
            _patch({ status: 'error', error: err.message });
            reject(err);
            return;
          }
          // Resolve relative redirects and validate the target host.
          let target;
          try { target = new URL(location, u); } catch {
            const err = new Error('Invalid redirect Location URL');
            _patch({ status: 'error', error: err.message });
            reject(err);
            return;
          }
          if (!allowedHosts.some(h => target.hostname === h || target.hostname.endsWith('.' + h))) {
            const err = new Error('Redirect target is not an allowed GitHub host');
            _patch({ status: 'error', error: err.message });
            reject(err);
            return;
          }
          redirected = true;
          get(target.href);
          return;
        }
        if (res.statusCode !== 200) {
          const err = new Error(`HTTP ${res.statusCode}`);
          _patch({ status: 'error', error: err.message });
          reject(err);
          return;
        }
        const total    = parseInt(res.headers['content-length'] || '0', 10);
        let   received = 0;
        const file     = fs.createWriteStream(destPath);

        res.on('data', chunk => {
          received += chunk.length;
          if (total > 0) _patch({ progress: Math.round(received / total * 100) });
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            _patch({ status: 'ready', downloadPath: destPath, progress: 100 });
            resolve(destPath);
          });
        });
        res.on('error', err => {
          fs.unlink(destPath, () => {});
          _patch({ status: 'error', error: err.message });
          reject(err);
        });
        file.on('error', err => {
          fs.unlink(destPath, () => {});
          _patch({ status: 'error', error: err.message });
          reject(err);
        });
      }).on('error', err => {
        _patch({ status: 'error', error: err.message });
        reject(err);
      });
    }
    get(url);
  });
}

// ── installUpdate ─────────────────────────────────────────────────────────────

/**
 * Mount the downloaded DMG, copy the new .app bundle over the running one,
 * unmount the volume, then restart the application.  macOS only.
 *
 * @returns {Promise<void>}  Resolves just before the restart is triggered.
 */
function installUpdate() {
  if (_state.status !== 'ready' || !_state.downloadPath) {
    return Promise.reject(new Error('No update ready to install'));
  }
  if (process.platform !== 'darwin') {
    return Promise.reject(new Error('Automatic install is only supported on macOS'));
  }

  _patch({ status: 'installing', error: null });

  return new Promise((resolve, reject) => {
    const dmgPath = _state.downloadPath;

    // Mount the DMG silently (no Finder window, no auto-open).
    cp.execFile('hdiutil', ['attach', '-nobrowse', '-noautoopen', dmgPath], (err, stdout) => {
      if (err) {
        _patch({ status: 'error', error: 'Failed to mount update: ' + err.message });
        reject(new Error(_state.error));
        return;
      }

      // hdiutil stdout format (tab-separated):  disk3s1\t<type>\t/Volumes/Frog…
      const mountPoint = stdout.split('\n')
        .map(l => l.split('\t').map(s => s.trim()))
        .map(parts => parts[parts.length - 1])
        .find(s => s.startsWith('/Volumes/'));

      if (!mountPoint) {
        _patch({ status: 'error', error: 'Could not find mounted volume' });
        reject(new Error(_state.error));
        return;
      }

      let files;
      try { files = fs.readdirSync(mountPoint); } catch (e) {
        _detach(mountPoint);
        _patch({ status: 'error', error: 'Cannot read mounted volume: ' + e.message });
        reject(new Error(_state.error));
        return;
      }

      const appName = files.find(f => f.endsWith('.app'));
      if (!appName) {
        _detach(mountPoint);
        _patch({ status: 'error', error: 'No .app bundle found in DMG' });
        reject(new Error(_state.error));
        return;
      }

      const srcApp  = path.join(mountPoint, appName);
      // Install to the same location as the currently-running bundle (or fall
      // back to /Applications if we are not inside an .app bundle, e.g. dev).
      const bundlePath = getAppBundlePath();
      const destApp    = bundlePath || path.join('/Applications', appName);

      // ditto preserves code signing and extended attributes.
      cp.execFile('ditto', [srcApp, destApp], (err) => {
        _detach(mountPoint);
        if (err) {
          _patch({ status: 'error', error: 'Failed to install update: ' + err.message });
          reject(new Error(_state.error));
          return;
        }
        resolve();
        setTimeout(_restartApp, RESTART_DELAY_MS);
      });
    });
  });
}

/* istanbul ignore next */
function _detach(mountPoint) {
  cp.execFile('hdiutil', ['detach', mountPoint, '-force'], () => {});
}

/* istanbul ignore next */
function _restartApp() {
  try {
    // Available when running inside the Electron process.
    const { app } = require('electron');
    app.relaunch();
    app.quit();
  } catch {
    process.exit(0);
  }
}

/** Cached reference to the database module (set on first successful require). */
let _db = null;

/**
 * Read the GitHub Personal Access Token from the database, if one has been
 * stored.  Returns null when no token is configured or when the DB is not
 * accessible (e.g. during unit tests that don't set up a database).
 *
 * @returns {string|null}
 */
function _getGithubPat() {
  try {
    if (!_db) _db = require('./db').db;
    const row = _db.prepare("SELECT enabled, credentials FROM api_credentials WHERE service = 'github'").get();
    if (!row || row.enabled !== 1) return null;
    const creds = JSON.parse(row.credentials || '{}');
    return creds.pat || null;
  } catch {
    return null;
  }
}

/** Allowed hostnames for GitHub API calls and redirects. */
const ALLOWED_API_HOSTS = [
  'api.github.com',
  'github.com',
];

/**
 * Fetch a URL and parse the response as JSON.  Follows one redirect, but only
 * to hosts in ALLOWED_API_HOSTS to prevent Server-Side Request Forgery (SSRF).
 * When `token` is provided it is sent as a Bearer Authorization header,
 * enabling access to private GitHub repositories.
 *
 * @param {string}      url
 * @param {string|null} [token]
 * @returns {Promise<object>}
 */
function _fetchJson(url, token) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch {
      reject(new Error('Invalid URL'));
      return;
    }
    if (!ALLOWED_API_HOSTS.includes(parsed.hostname)) {
      reject(new Error(`URL host '${parsed.hostname}' is not an allowed GitHub API host`));
      return;
    }

    const headers = {
      'User-Agent': `FrogAutomation/${getCurrentVersion()}`,
      'Accept':     'application/vnd.github.v3+json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    https.get(parsed, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        reject(new Error('Unexpected redirect from GitHub API'));
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.message) reject(new Error(`GitHub API: ${json.message}`));
          else resolve(json);
        } catch (e) {
          reject(new Error('Failed to parse GitHub API response'));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── resolvePRBuild ────────────────────────────────────────────────────────────

/**
 * Parse a GitHub PR URL, locate the corresponding pre-release test build, and
 * set it as the installation target via selectVersionForInstall().
 *
 * The CI workflow publishes a pre-release tagged `pr-{number}-preview` whenever
 * the "test-build" label is applied to a pull-request.  This function looks up
 * that release and — if found — places the updater into the 'available' state
 * so the existing download / install flow can proceed unchanged.
 *
 * @param {string} prUrl  e.g. https://github.com/jmhthethird/frog_automation/pull/42
 * @returns {Promise<UpdateState>}
 */
async function resolvePRBuild(prUrl) {
  const match = (prUrl || '').match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i
  );
  if (!match) {
    _patch({ status: 'error', error: 'Invalid GitHub PR URL — expected https://github.com/{owner}/{repo}/pull/{number}' });
    return getState();
  }

  const [, owner, repo, rawPrNumber] = match;

  // Security: only allow installing builds from this app's own repository.
  if (owner.toLowerCase() !== GITHUB_OWNER.toLowerCase() ||
      repo.toLowerCase()  !== GITHUB_REPO.toLowerCase()) {
    _patch({
      status: 'error',
      error:  `PR builds can only be installed from ${GITHUB_OWNER}/${GITHUB_REPO}`,
    });
    return getState();
  }

  // Sanitize the PR number to a plain integer — discard any other user input.
  const prNumber = parseInt(rawPrNumber, 10);
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    _patch({ status: 'error', error: 'Invalid PR number' });
    return getState();
  }

  const tag = `pr-${prNumber}-preview`;

  _patch({ status: 'checking', error: null });

  const token = _getGithubPat();
  let release;
  try {
    // Use module-level constants (not user-derived captures) to build the URL.
    release = await _fetchJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${tag}`,
      token
    );
  } catch (err) {
    const notFound = /not found/i.test(err.message);
    const msg = notFound
      ? `No test build found for PR #${prNumber}. Apply the "test-build" label on the PR to trigger a build.`
      : err.message;
    _patch({ status: 'error', error: msg });
    return getState();
  }

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const arch   = process.arch;
  const asset  = arch === 'arm64'
    ? assets.find(a => a.name.endsWith('-arm64.dmg'))
    : assets.find(a => a.name.endsWith('.dmg') && !a.name.includes('arm64'));

  selectVersionForInstall(
    tag,
    asset ? asset.browser_download_url : null,
    release.html_url  || null,
    release.body      || null
  );
  return getState();
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  checkForUpdate,
  listAllReleases,
  selectVersionForInstall,
  resolvePRBuild,
  downloadUpdate,
  installUpdate,
  getState,
  // Exported for testing
  isNewer,
  getCurrentVersion,
};
