'use strict';

/**
 * Unit tests for src/updater.js.
 *
 * Network calls (https.get), file-system writes, and child_process.execFile
 * are mocked so the tests run offline and without any macOS-specific tools.
 */

const https        = require('https');
const fs           = require('fs');
const { EventEmitter } = require('events');

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Create an https.get spy that responds with the given parameters.
 * Events (data, end) are emitted in a nested nextTick so they fire AFTER the
 * caller's callback has attached its listeners.
 */
function makeHttpsSpy({ statusCode = 200, body = '', headers = {}, redirectTo = null } = {}) {
  return jest.spyOn(https, 'get').mockImplementation((url, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; }

    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.headers = { ...headers };
    if (redirectTo) res.headers.location = redirectTo;

    res.pipe = jest.fn((dest) => {
      process.nextTick(() => dest.emit('finish'));
      return dest;
    });

    process.nextTick(() => {
      cb(res);
      process.nextTick(() => {
        const buf = typeof body === 'object'
          ? Buffer.from(JSON.stringify(body))
          : Buffer.from(String(body));
        if (buf.length > 0) res.emit('data', buf);
        res.emit('end');
      });
    });

    return { on: jest.fn().mockReturnThis() };
  });
}

/** Mock fs.createWriteStream so no real file is written. */
function makeWriteStreamMock() {
  const mockFile = new EventEmitter();
  mockFile.close = jest.fn((cb) => { if (cb) cb(); });
  jest.spyOn(fs, 'createWriteStream').mockReturnValue(mockFile);
  return mockFile;
}

/** Drive the updater to 'ready' state via a mocked successful download. */
async function driveToReady(updater) {
  makeWriteStreamMock();
  makeHttpsSpy({ headers: { 'content-length': '0' } });
  await updater.downloadUpdate(
    'https://github.com/jmhthethird/frog_automation/releases/download/v99.0.0/app-arm64.dmg'
  );
}

/** Build a minimal GitHub releases API response. */
function fakeRelease(tag, assets = []) {
  return {
    tag_name: tag,
    html_url: `https://github.com/jmhthethird/frog_automation/releases/tag/${tag}`,
    assets,
  };
}

// ─── isNewer ──────────────────────────────────────────────────────────────────

describe('isNewer()', () => {
  let updater;
  beforeEach(() => { jest.resetModules(); updater = require('../../src/updater'); });

  it('returns true when major version is higher',   () => expect(updater.isNewer('1.0.0', '2.0.0')).toBe(true));
  it('returns true when minor version is higher',   () => expect(updater.isNewer('1.0.0', '1.1.0')).toBe(true));
  it('returns true when patch version is higher',   () => expect(updater.isNewer('1.0.0', '1.0.1')).toBe(true));
  it('returns false when versions are equal',       () => expect(updater.isNewer('1.2.3', '1.2.3')).toBe(false));
  it('returns false when b is older than a',        () => expect(updater.isNewer('2.0.0', '1.9.9')).toBe(false));
  it('strips leading "v" from version strings', () => {
    expect(updater.isNewer('v1.0.0', 'v1.0.1')).toBe(true);
    expect(updater.isNewer('v1.0.1', 'v1.0.0')).toBe(false);
  });
});

// ─── getCurrentVersion ────────────────────────────────────────────────────────

describe('getCurrentVersion()', () => {
  it('returns the version from package.json', () => {
    jest.resetModules();
    const updater = require('../../src/updater');
    const pkg     = require('../../package.json');
    expect(updater.getCurrentVersion()).toBe(pkg.version);
  });
});

// ─── getState ─────────────────────────────────────────────────────────────────

describe('getState()', () => {
  it('returns the expected initial shape', () => {
    jest.resetModules();
    const state = require('../../src/updater').getState();
    expect(state).toMatchObject({
      status:         'idle',
      currentVersion: expect.any(String),
      latestVersion:  null,
      releaseUrl:     null,
      downloadUrl:    null,
      downloadPath:   null,
      progress:       0,
      error:          null,
    });
  });
});

// ─── checkForUpdate ───────────────────────────────────────────────────────────

describe('checkForUpdate()', () => {
  let updater;

  beforeEach(() => { jest.resetModules(); updater = require('../../src/updater'); });
  afterEach(() => jest.restoreAllMocks());

  it('sets status to up-to-date when remote version equals current', async () => {
    const pkg = require('../../package.json');
    makeHttpsSpy({ body: fakeRelease(`v${pkg.version}`) });
    const state = await updater.checkForUpdate();
    expect(state.status).toBe('up-to-date');
    expect(state.latestVersion).toBe(pkg.version);
  });

  it('sets status to available and picks arm64 asset', async () => {
    const origArch = process.arch;
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    try {
      makeHttpsSpy({
        body: fakeRelease('v999.0.0', [
          { name: 'Frog Automation-999.0.0-arm64.dmg', browser_download_url: 'https://github.com/jmhthethird/frog_automation/releases/download/v999.0.0/app-arm64.dmg' },
          { name: 'Frog Automation-999.0.0.dmg',       browser_download_url: 'https://github.com/jmhthethird/frog_automation/releases/download/v999.0.0/app.dmg' },
        ]),
      });
      const state = await updater.checkForUpdate();
      expect(state.status).toBe('available');
      expect(state.downloadUrl).toContain('arm64');
    } finally {
      Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
    }
  });

  it('picks x64 asset when arch is x64', async () => {
    const origArch = process.arch;
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    try {
      makeHttpsSpy({
        body: fakeRelease('v999.0.0', [
          { name: 'Frog Automation-999.0.0-arm64.dmg', browser_download_url: 'https://github.com/jmhthethird/frog_automation/releases/download/v999.0.0/app-arm64.dmg' },
          { name: 'Frog Automation-999.0.0.dmg',       browser_download_url: 'https://github.com/jmhthethird/frog_automation/releases/download/v999.0.0/app.dmg' },
        ]),
      });
      const state = await updater.checkForUpdate();
      expect(state.status).toBe('available');
      expect(state.downloadUrl).not.toContain('arm64');
    } finally {
      Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
    }
  });

  it('sets downloadUrl to null when no matching asset exists', async () => {
    makeHttpsSpy({ body: fakeRelease('v999.0.0', []) });
    const state = await updater.checkForUpdate();
    expect(state.status).toBe('available');
    expect(state.downloadUrl).toBeNull();
  });

  it('sets status to error on network failure', async () => {
    jest.spyOn(https, 'get').mockImplementation((url, opts, cb) => {
      const req = {
        on: jest.fn((event, handler) => {
          if (event === 'error') process.nextTick(() => handler(new Error('ENOTFOUND')));
          return req;
        }),
      };
      return req;
    });
    const state = await updater.checkForUpdate();
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/ENOTFOUND/);
  });

  it('sets status to error when GitHub API returns an error message', async () => {
    makeHttpsSpy({ body: { message: 'Not Found' } });
    const state = await updater.checkForUpdate();
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/GitHub API/);
  });

  it('sets status to error when tag_name is missing', async () => {
    makeHttpsSpy({ body: { html_url: 'https://github.com' } });
    const state = await updater.checkForUpdate();
    expect(state.status).toBe('error');
  });

  it('sets status to error when response is invalid JSON', async () => {
    makeHttpsSpy({ body: 'not-json' });
    const state = await updater.checkForUpdate();
    expect(state.status).toBe('error');
  });
});

// ─── downloadUpdate ───────────────────────────────────────────────────────────

describe('downloadUpdate()', () => {
  let updater;

  beforeEach(() => { jest.resetModules(); updater = require('../../src/updater'); });
  afterEach(() => jest.restoreAllMocks());

  it('rejects for a non-GitHub URL', async () => {
    await expect(updater.downloadUpdate('https://evil.com/bad.dmg'))
      .rejects.toThrow(/github\.com/);
  });

  it('rejects for an invalid URL string', async () => {
    await expect(updater.downloadUpdate('not-a-url')).rejects.toThrow();
  });

  it('rejects if a download is already in progress', async () => {
    jest.spyOn(https, 'get').mockImplementation(() => ({ on: jest.fn().mockReturnThis() }));
    const p1 = updater.downloadUpdate(
      'https://github.com/jmhthethird/frog_automation/releases/download/v99/app-arm64.dmg'
    );
    await expect(
      updater.downloadUpdate('https://github.com/jmhthethird/frog_automation/releases/download/v99/app-arm64.dmg')
    ).rejects.toThrow(/in progress/);
    p1.catch(() => {});
  });

  it('resolves with the local file path and sets state to ready', async () => {
    makeWriteStreamMock();
    makeHttpsSpy({ headers: { 'content-length': '0' } });
    const filePath = await updater.downloadUpdate(
      'https://github.com/jmhthethird/frog_automation/releases/download/v2.0.0/Frog-Automation-2.0.0-arm64.dmg'
    );
    expect(filePath).toMatch(/Frog-Automation-2\.0\.0-arm64\.dmg/);
    expect(updater.getState().status).toBe('ready');
    expect(updater.getState().progress).toBe(100);
  });

  it('tracks progress when content-length header is present', async () => {
    makeWriteStreamMock();
    jest.spyOn(https, 'get').mockImplementation((url, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; }
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = { 'content-length': '1000' };
      res.pipe = jest.fn((dest) => {
        process.nextTick(() => dest.emit('finish'));
        return dest;
      });
      process.nextTick(() => {
        cb(res);
        process.nextTick(() => {
          res.emit('data', Buffer.alloc(500));
          res.emit('data', Buffer.alloc(500));
          res.emit('end');
        });
      });
      return { on: jest.fn().mockReturnThis() };
    });
    await updater.downloadUpdate(
      'https://github.com/jmhthethird/frog_automation/releases/download/v2.0.0/app.dmg'
    );
    expect(updater.getState().status).toBe('ready');
  });

  it('sets status to error on HTTP non-200 response', async () => {
    makeHttpsSpy({ statusCode: 404, body: 'Not Found' });
    await expect(
      updater.downloadUpdate('https://github.com/jmhthethird/frog_automation/releases/download/v2.0.0/app.dmg')
    ).rejects.toThrow(/HTTP 404/);
    expect(updater.getState().status).toBe('error');
  });

  it('follows a 302 redirect', async () => {
    makeWriteStreamMock();
    let callCount = 0;
    jest.spyOn(https, 'get').mockImplementation((url, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; }
      callCount++;
      const isRedirect = callCount === 1;
      const res = new EventEmitter();
      res.statusCode = isRedirect ? 302 : 200;
      res.headers = isRedirect
        ? { location: 'https://objects.githubusercontent.com/asset/app.dmg' }
        : { 'content-length': '0' };
      res.pipe = jest.fn((dest) => { process.nextTick(() => dest.emit('finish')); return dest; });
      process.nextTick(() => {
        cb(res);
        process.nextTick(() => res.emit('end'));
      });
      return { on: jest.fn().mockReturnThis() };
    });
    await updater.downloadUpdate(
      'https://github.com/jmhthethird/frog_automation/releases/download/v2.0.0/app.dmg'
    );
    expect(callCount).toBe(2);
    expect(updater.getState().status).toBe('ready');
  });

  it('sets status to error on request-level network error', async () => {
    jest.spyOn(https, 'get').mockImplementation((url, opts, cb) => {
      const req = {
        on: jest.fn((event, handler) => {
          if (event === 'error') process.nextTick(() => handler(new Error('ECONNRESET')));
          return req;
        }),
      };
      return req;
    });
    await expect(
      updater.downloadUpdate('https://github.com/jmhthethird/frog_automation/releases/download/v2.0.0/app.dmg')
    ).rejects.toThrow(/ECONNRESET/);
    expect(updater.getState().status).toBe('error');
  });
});

// ─── installUpdate ────────────────────────────────────────────────────────────

describe('installUpdate()', () => {
  let updater;

  beforeEach(() => { jest.resetModules(); updater = require('../../src/updater'); });
  afterEach(() => jest.restoreAllMocks());

  it('rejects when no update is ready', async () => {
    await expect(updater.installUpdate()).rejects.toThrow(/No update ready/);
  });

  it('rejects on non-macOS platforms when state is ready', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      await driveToReady(updater);
      await expect(updater.installUpdate()).rejects.toThrow(/macOS/i);
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });

  /**
   * Put updater in 'ready', mock platform to 'darwin', mock system calls,
   * call installUpdate() and return the resulting promise.
   */
  async function installWithMocks(execFileMock, readdirMock) {
    await driveToReady(updater);

    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    jest.spyOn(require('child_process'), 'execFile').mockImplementation(execFileMock);
    if (readdirMock) jest.spyOn(fs, 'readdirSync').mockImplementation(readdirMock);
    jest.spyOn(global, 'setTimeout').mockImplementation(() => {});

    try {
      return await updater.installUpdate();
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  }

  it('rejects when hdiutil attach fails', async () => {
    await expect(
      installWithMocks(
        (cmd, args, cb) => cb(new Error('resource busy'), '', ''),
        null
      )
    ).rejects.toThrow(/Failed to mount/);
    expect(updater.getState().status).toBe('error');
  });

  it('rejects when no /Volumes/ line in hdiutil output', async () => {
    await expect(
      installWithMocks(
        (cmd, args, cb) => cb(null, 'disk3\tapple_hfs\t/dev/disk3\n', ''),
        null
      )
    ).rejects.toThrow(/Could not find mounted volume/);
    expect(updater.getState().status).toBe('error');
  });

  it('rejects when readdirSync throws on the mount point', async () => {
    await expect(
      installWithMocks(
        (cmd, args, cb) => cb(null, 'disk3s1\tapple_hfs\t/Volumes/Frog Automation 2.0.0\n', ''),
        () => { throw new Error('ENOENT'); }
      )
    ).rejects.toThrow(/Cannot read mounted volume/);
    expect(updater.getState().status).toBe('error');
  });

  it('rejects when no .app file found in DMG', async () => {
    await expect(
      installWithMocks(
        (cmd, args, cb) => cb(null, 'disk3s1\tapple_hfs\t/Volumes/Frog Automation 2.0.0\n', ''),
        () => ['README.txt', 'install.sh']
      )
    ).rejects.toThrow(/No \.app bundle/);
    expect(updater.getState().status).toBe('error');
  });

  it('rejects when ditto fails', async () => {
    await expect(
      installWithMocks(
        (cmd, args, cb) => {
          if (args[0] === 'attach') {
            cb(null, 'disk3s1\tapple_hfs\t/Volumes/Frog Automation 2.0.0\n', '');
          } else {
            cb(new Error('Operation not permitted'), '', '');
          }
        },
        () => ['Frog Automation.app']
      )
    ).rejects.toThrow(/Failed to install/);
    expect(updater.getState().status).toBe('error');
  });

  it('resolves and schedules restart on full success', async () => {
    await expect(
      installWithMocks(
        (cmd, args, cb) => cb(null, 'disk3s1\tapple_hfs\t/Volumes/Frog Automation 2.0.0\n', ''),
        () => ['Frog Automation.app']
      )
    ).resolves.toBeUndefined();
    expect(updater.getState().status).toBe('installing');
    expect(global.setTimeout).toHaveBeenCalled();
  });
});
