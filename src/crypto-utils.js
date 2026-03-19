'use strict';

/**
 * Symmetric encryption helpers for sensitive credential values stored in the
 * database (e.g. the Google Drive OAuth2 refresh_token).
 *
 * Encryption is opt-in: it is active only when the ENCRYPTION_SECRET
 * environment variable is set to a non-empty string.  When it is absent the
 * helpers return the plain-text value unchanged so that existing installations
 * continue to work without any migration step.
 *
 * Algorithm: AES-256-GCM
 *   key    = first 32 bytes of SHA-256(ENCRYPTION_SECRET)
 *   output = "enc:" + base64(iv + authTag + ciphertext)
 *
 * The "enc:" prefix lets us distinguish encrypted values from plain-text ones
 * during the migration period, enabling transparent decryption of both.
 */

const crypto = require('crypto');

const ALGORITHM  = 'aes-256-gcm';
const IV_BYTES   = 12; // 96-bit IV recommended for GCM
const TAG_BYTES  = 16;
const ENC_PREFIX = 'enc:';

/** Derive a 32-byte key from the raw secret string. */
function _deriveKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plain-text string.
 * Returns a prefixed base64 string, or the original value when
 * ENCRYPTION_SECRET is not set or the value is empty/falsy.
 * Falsy values (empty string, null, undefined) are always returned as-is.
 *
 * @param {string} plaintext
 * @returns {string}
 */
function encrypt(plaintext) {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || !plaintext) return plaintext;

  const key = _deriveKey(secret);
  const iv  = crypto.randomBytes(IV_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  // Layout: iv (12 bytes) | authTag (16 bytes) | ciphertext
  const combined = Buffer.concat([iv, tag, enc]);
  return ENC_PREFIX + combined.toString('base64');
}

/**
 * Decrypt a value previously produced by encrypt().
 * Returns the original value unchanged when:
 *   - ENCRYPTION_SECRET is not set, or
 *   - the value does not carry the "enc:" prefix (plain-text migration path).
 *
 * Throws when the secret is set but decryption fails (e.g. wrong key, tampered
 * ciphertext) so the caller can surface a meaningful error rather than
 * silently returning garbage.
 *
 * @param {string} value
 * @returns {string}
 */
function decrypt(value) {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || !value) return value;

  // Not yet encrypted (stored before encryption was enabled) – pass through.
  if (!value.startsWith(ENC_PREFIX)) return value;

  const key = _deriveKey(secret);
  const buf = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');

  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Encrypted credential value is too short – data may be corrupted');
  }

  const iv         = buf.subarray(0, IV_BYTES);
  const tag        = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Encrypt a value only if it is not already encrypted.
 * No-op when ENCRYPTION_SECRET is absent or the value is empty.
 *
 * @param {string} value
 * @returns {string}
 */
function ensureEncrypted(value) {
  if (!value) return value;
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) return value;
  // Already encrypted – nothing to do.
  if (value.startsWith(ENC_PREFIX)) return value;
  return encrypt(value);
}

module.exports = { encrypt, decrypt, ensureEncrypted };
