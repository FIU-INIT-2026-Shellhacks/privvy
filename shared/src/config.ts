/**
 * Shared configuration: the NAMES of environment variables and the shared numeric
 * bounds. This file holds no secrets — only the contract for what config exists and its
 * default bounds, so client and server agree.
 */

/** Environment variable names used across the project. */
export const ENV = {
  /** Server secret: Gemini API key. Never read client-side. */
  GEMINI_API_KEY: 'GEMINI_API_KEY',
  /** Server env: Gemini model name. Required, no default. */
  GEMINI_MODEL: 'GEMINI_MODEL',
  /** Server env: per-IP rate-limit window (seconds); also the hashed-IP counter TTL. */
  RATE_LIMIT_WINDOW: 'RATE_LIMIT_WINDOW',
  /** Server env: max requests per window per IP. */
  RATE_LIMIT_MAX: 'RATE_LIMIT_MAX',
  /** Client + server: minimum normalized text length. */
  MIN_TEXT_CHARS: 'MIN_TEXT_CHARS',
  /** Client + server: maximum normalized text length. */
  MAX_TEXT_CHARS: 'MAX_TEXT_CHARS',
  /** Extension: base URL of the deployed /analyze backend. */
  PRIVVY_BACKEND_URL: 'PRIVVY_BACKEND_URL',
} as const;

/**
 * Default text-length bounds (characters). Below MIN implies a failed extraction; above
 * MAX is truncated before hashing/sending. Deployments may override via env.
 */
export const TEXT_BOUNDS = {
  MIN_TEXT_CHARS: 500,
  MAX_TEXT_CHARS: 100_000,
} as const;

/** Default per-IP rate-limit settings. Deployments may override via env. */
export const RATE_LIMIT_DEFAULTS = {
  /** Window length in seconds. */
  WINDOW_SECONDS: 60,
  /** Max requests allowed per window per IP. */
  MAX_REQUESTS: 10,
} as const;
