import { describe, it, expect } from 'vitest';
import { normalizeText, sha256Hex, contentHash } from './normalize.js';
import { HASH_VECTORS } from './vectors.js';

describe('normalizeText', () => {
  it('collapses whitespace runs, normalizes CRLF, and trims', () => {
    expect(normalizeText('  Hello\r\n\tWorld   \n\n foo  ')).toBe('Hello World foo');
  });

  it('is idempotent: normalize(normalize(x)) === normalize(x)', () => {
    for (const { raw } of HASH_VECTORS) {
      const once = normalizeText(raw);
      expect(normalizeText(once)).toBe(once);
    }
  });

  it('produces the expected normalized form for each parity vector', () => {
    for (const { raw, normalized } of HASH_VECTORS) {
      expect(normalizeText(raw)).toBe(normalized);
    }
  });
});

describe('sha256Hex', () => {
  it('matches the canonical SHA-256 vector for "abc"', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the already-normalized string of each vector to its known hash', async () => {
    for (const { normalized, hash } of HASH_VECTORS) {
      await expect(sha256Hex(normalized)).resolves.toBe(hash);
    }
  });
});

describe('contentHash (parity vectors — shared with client Task 11)', () => {
  it('normalizes then hashes to the expected hash for every vector', async () => {
    for (const { raw, hash } of HASH_VECTORS) {
      await expect(contentHash(raw)).resolves.toBe(hash);
    }
  });

  it('dedupes: whitespace-different copies of the same text share a hash', async () => {
    const a = await contentHash('  Hello\r\n\tWorld   \n\n foo  ');
    const b = await contentHash('Hello World foo');
    expect(a).toBe(b);
  });

  it('distinguishes: different text yields a different hash', async () => {
    const a = await contentHash('Hello World foo');
    const b = await contentHash('Hello World bar');
    expect(a).not.toBe(b);
  });
});
