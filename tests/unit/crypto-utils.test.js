'use strict';

const { encrypt, decrypt, ensureEncrypted } = require('../../src/crypto-utils');

// ─── Helper: set / clear ENCRYPTION_SECRET ────────────────────────────────────
function withSecret(secret, fn) {
  const original = process.env.ENCRYPTION_SECRET;
  process.env.ENCRYPTION_SECRET = secret;
  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env.ENCRYPTION_SECRET;
    } else {
      process.env.ENCRYPTION_SECRET = original;
    }
  }
}

// ─── encrypt() ────────────────────────────────────────────────────────────────
describe('encrypt()', () => {
  it('returns the plaintext unchanged when ENCRYPTION_SECRET is not set', () => {
    const result = withSecret('', () => encrypt('my-secret'));
    expect(result).toBe('my-secret');
  });

  it('returns empty string unchanged', () => {
    withSecret('key123', () => {
      expect(encrypt('')).toBe('');
      expect(encrypt(undefined)).toBeUndefined();
    });
  });

  it('returns a string prefixed with "enc:" when a secret is set', () => {
    const result = withSecret('test-secret', () => encrypt('refresh_token_value'));
    expect(result).toMatch(/^enc:/);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const a = withSecret('test-secret', () => encrypt('same-plaintext'));
    const b = withSecret('test-secret', () => encrypt('same-plaintext'));
    expect(a).not.toBe(b);
  });
});

// ─── decrypt() ────────────────────────────────────────────────────────────────
describe('decrypt()', () => {
  it('returns the value unchanged when ENCRYPTION_SECRET is not set', () => {
    const result = withSecret('', () => decrypt('enc:someciphertext'));
    expect(result).toBe('enc:someciphertext');
  });

  it('returns a plain-text value (no enc: prefix) unchanged even when secret is set', () => {
    const result = withSecret('test-secret', () => decrypt('plaintext_rt'));
    expect(result).toBe('plaintext_rt');
  });

  it('returns empty / falsy values unchanged', () => {
    withSecret('test-secret', () => {
      expect(decrypt('')).toBe('');
      expect(decrypt(null)).toBeNull();
      expect(decrypt(undefined)).toBeUndefined();
    });
  });

  it('round-trips encrypt → decrypt correctly', () => {
    const plaintext = 'my_refresh_token_abc123';
    const result = withSecret('round-trip-secret', () => {
      const ciphertext = encrypt(plaintext);
      return decrypt(ciphertext);
    });
    expect(result).toBe(plaintext);
  });

  it('round-trips correctly for tokens with special characters', () => {
    const token = 'token/with+special==chars&more';
    const result = withSecret('special-chars-secret', () => {
      return decrypt(encrypt(token));
    });
    expect(result).toBe(token);
  });

  it('throws when the secret is set but the encrypted value is corrupted', () => {
    expect(() => {
      withSecret('test-secret', () => decrypt('enc:dGhpcyBpcyBub3QgdmFsaWQ=')); // too short
    }).toThrow(/too short|corrupted/i);
  });

  it('throws when decrypted with the wrong key', () => {
    const ciphertext = withSecret('key-A', () => encrypt('sensitive'));
    expect(() => {
      withSecret('key-B', () => decrypt(ciphertext));
    }).toThrow();
  });
});

// ─── ensureEncrypted() ────────────────────────────────────────────────────────
describe('ensureEncrypted()', () => {
  it('returns plain-text value unchanged when ENCRYPTION_SECRET is not set', () => {
    const result = withSecret('', () => ensureEncrypted('plain_token'));
    expect(result).toBe('plain_token');
  });

  it('encrypts a plain-text value when the secret is set', () => {
    const result = withSecret('secret', () => ensureEncrypted('plain_token'));
    expect(result).toMatch(/^enc:/);
  });

  it('does not re-encrypt an already-encrypted value', () => {
    const ciphertext = withSecret('secret', () => encrypt('token'));
    const result = withSecret('secret', () => ensureEncrypted(ciphertext));
    expect(result).toBe(ciphertext);
  });

  it('returns empty / falsy values unchanged', () => {
    withSecret('secret', () => {
      expect(ensureEncrypted('')).toBe('');
      expect(ensureEncrypted(null)).toBeNull();
      expect(ensureEncrypted(undefined)).toBeUndefined();
    });
  });
});
