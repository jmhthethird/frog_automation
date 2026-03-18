'use strict';

const crypto = require('crypto');

// Encryption algorithm and constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For GCM mode
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Get the encryption key from environment variable or generate a default.
 * In production, ENCRYPTION_KEY should be set to a secure random value.
 * @returns {Buffer}
 */
function getEncryptionKey() {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    // Support both hex and base64 encoded keys
    if (envKey.length === 64) {
      return Buffer.from(envKey, 'hex');
    }
    return Buffer.from(envKey, 'base64');
  }

  // Default key for development/testing - NOT SECURE
  // In production, this should be generated with: crypto.randomBytes(32).toString('hex')
  console.warn('[crypto-utils] Using default encryption key. Set ENCRYPTION_KEY env var for production.');
  return crypto.scryptSync('frog-automation-default-key', 'salt', 32);
}

/**
 * Encrypt a string using AES-256-GCM.
 * Returns a base64-encoded string containing: salt + iv + authTag + ciphertext
 *
 * @param {string} text - Plain text to encrypt
 * @returns {string} Base64-encoded encrypted data
 */
function encrypt(text) {
  if (!text || typeof text !== 'string') {
    throw new TypeError('Text to encrypt must be a non-empty string');
  }

  const key = getEncryptionKey();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Combine all parts: salt + iv + authTag + encrypted
  const combined = Buffer.concat([
    salt,
    iv,
    authTag,
    Buffer.from(encrypted, 'hex')
  ]);

  return combined.toString('base64');
}

/**
 * Decrypt a string that was encrypted with encrypt().
 *
 * @param {string} encryptedData - Base64-encoded encrypted data
 * @returns {string} Decrypted plain text
 */
function decrypt(encryptedData) {
  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new TypeError('Encrypted data must be a non-empty string');
  }

  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedData, 'base64');

    // Extract parts
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    throw new Error(`Decryption failed: ${err.message}`);
  }
}

/**
 * Check if a value appears to be encrypted (base64 with sufficient length).
 * This is a heuristic check, not cryptographically sound.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  if (!value || typeof value !== 'string') return false;

  // Encrypted values are base64 and longer than minimum length (salt + iv + tag + data)
  const minLength = Math.ceil((SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 10) * 4 / 3);
  if (value.length < minLength) return false;

  // Check if it's valid base64
  return /^[A-Za-z0-9+/]+=*$/.test(value);
}

module.exports = { encrypt, decrypt, isEncrypted };
