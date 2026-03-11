'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Candidate SF data directories per OS.
const SF_DATA_DIR_CANDIDATES = [
  path.join(os.homedir(), '.ScreamingFrogSEOSpider'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Screaming Frog SEO Spider'),
];

/**
 * Return the first accessible SF data directory on this machine, or null.
 *
 * When the SF_DATA_DIR environment variable is set it is validated:
 *   - it must point to an existing directory that is readable.
 *   - if it fails validation a warning is logged and candidate-path detection
 *     proceeds as normal.
 *
 * This lets tests supply a controlled directory without relying on a real
 * Screaming Frog installation on the host machine.
 */
function getLocalSfDataDir() {
  const envDir = process.env.SF_DATA_DIR;
  if (envDir) {
    try {
      const stat = fs.statSync(envDir);
      if (!stat.isDirectory()) {
        console.warn('[sf-paths] SF_DATA_DIR is not a directory:', envDir);
      } else {
        fs.accessSync(envDir, fs.constants.R_OK);
        return envDir;
      }
    } catch (err) {
      console.warn('[sf-paths] SF_DATA_DIR is not accessible:', envDir, '-', err.message);
    }
  }

  for (const dir of SF_DATA_DIR_CANDIDATES) {
    try {
      fs.accessSync(dir, fs.constants.R_OK);
      return dir;
    } catch { /* try next */ }
  }
  return null;
}

module.exports = { getLocalSfDataDir, SF_DATA_DIR_CANDIDATES };
