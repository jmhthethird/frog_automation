'use strict';

const { extractDomain, buildJobLabel } = require('../../src/utils');

// ─── extractDomain() ──────────────────────────────────────────────────────────
describe('extractDomain()', () => {
  it('extracts the domain from a subdomain URL', () => {
    expect(extractDomain('https://wwe.google.com')).toBe('google');
  });

  it('extracts the domain from a www URL', () => {
    expect(extractDomain('https://www.example.com')).toBe('example');
  });

  it('extracts the domain from a bare domain URL', () => {
    expect(extractDomain('https://example.com')).toBe('example');
  });

  it('returns "unknown" for an invalid URL', () => {
    expect(extractDomain('not-a-url')).toBe('unknown');
  });

  it('replaces non-alphanumeric characters with underscores', () => {
    // hostname parts that contain hyphens are valid – hyphens should be kept
    expect(extractDomain('https://my-site.example.com')).toBe('example');
  });
});

// ─── buildJobLabel() ──────────────────────────────────────────────────────────
describe('buildJobLabel()', () => {
  it('builds a label with the expected format', () => {
    const label = buildJobLabel('https://wwe.google.com', '2025-03-10 15:14:00', 13);
    expect(label).toBe('google_2025-03-10_03-14PM-job13');
  });

  it('uses AM for morning times', () => {
    const label = buildJobLabel('https://example.com', '2025-03-10 09:05:00', 7);
    expect(label).toBe('example_2025-03-10_09-05AM-job7');
  });

  it('handles midnight (00:00) correctly', () => {
    const label = buildJobLabel('https://example.com', '2025-03-10 00:00:00', 1);
    expect(label).toBe('example_2025-03-10_12-00AM-job1');
  });

  it('handles noon (12:00) correctly', () => {
    const label = buildJobLabel('https://example.com', '2025-03-10 12:00:00', 2);
    expect(label).toBe('example_2025-03-10_12-00PM-job2');
  });

  it('falls back to current time when completedAt is null', () => {
    // Just verify the format matches – exact timestamp will vary.
    const label = buildJobLabel('https://example.com', null, 99);
    expect(label).toMatch(/^example_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}[AP]M-job99$/);
  });

  it('uses "unknown" for invalid URLs', () => {
    const label = buildJobLabel('bad-url', '2025-03-10 15:00:00', 5);
    expect(label).toBe('unknown_2025-03-10_03-00PM-job5');
  });
});
