/**
 * Shared hash/normalization parity vectors — the source of truth for cross-track
 * agreement. Both the server util (Task 3) and the client util (Task 11) assert
 * against these exact pairs, so if either side drifts, its tests fail.
 *
 * Each `hash` is SHA-256 hex of the UTF-8 bytes of `normalized`, and `normalized`
 * is `normalizeText(raw)`. Values were generated from the reference implementation
 * in `normalize.ts` and cross-checked against a known vector (sha256("abc")).
 */

export interface HashVector {
  /** Human label for the case. */
  readonly name: string;
  /** Raw input before normalization. */
  readonly raw: string;
  /** Expected result of normalizeText(raw). */
  readonly normalized: string;
  /** Expected contentHash(raw) = sha256Hex(normalizeText(raw)). */
  readonly hash: string;
}

export const HASH_VECTORS: readonly HashVector[] = [
  {
    name: 'empty string',
    raw: '',
    normalized: '',
    hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  {
    name: 'simple ascii (known SHA-256 vector)',
    raw: 'abc',
    normalized: 'abc',
    hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
  {
    name: 'collapse whitespace, CRLF, and trim',
    raw: '  Hello\r\n\tWorld   \n\n foo  ',
    normalized: 'Hello World foo',
    hash: '0d32d6b5eb08f2247374eb07b452651acd18619a1ee3e38bd8c80152798f1e83',
  },
  {
    name: 'unicode (accented, multi-word)',
    raw: 'Café  \t politique\nde   confidentialité',
    normalized: 'Café politique de confidentialité',
    hash: 'ddbb84a53453cea393f55698fce7ae35bd9558e38d981e96ee10fa0e744472a1',
  },
] as const;
