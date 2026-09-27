/**
 * GeminiProvider (Task 4): the MVP LlmProvider, calling Gemini's `generateContent`
 * REST endpoint on the model named by GEMINI_MODEL.
 *
 * - The model name has NO hardcoded default: Google restricts model access per project,
 *   so the deploying project MUST set GEMINI_MODEL to a model it can actually access
 *   (see design + Task 15). Unset -> a clear config error (INTERNAL), never a fallback.
 * - The API key is read from a server-side env/secret and is never logged or returned.
 * - Any upstream error/timeout -> typed LlmError(UPSTREAM). Option A: no retry here.
 */

import { ErrorCode } from '../../../shared/dist/errors.js';
import { ENV } from '../../../shared/dist/config.js';
import { LlmError, type LlmProvider, type Summary } from './provider.ts';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Shape of the subset of the generateContent response we read. */
interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export interface GeminiProviderOptions {
  /** Reader for env vars; defaults to Deno.env.get. Injectable for tests. */
  getEnv?: (name: string) => string | undefined;
  /** fetch implementation; defaults to global fetch. Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
}

export class GeminiProvider implements LlmProvider {
  readonly #getEnv: (name: string) => string | undefined;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(opts: GeminiProviderOptions = {}) {
    // Fall back to Deno.env only if no reader is injected, so this module can be
    // imported and unit-tested without a Deno global present.
    this.#getEnv =
      opts.getEnv ??
      ((name: string) =>
        (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(
          name,
        ));
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async summarize(policyText: string): Promise<Summary> {
    const model = this.#getEnv(ENV.GEMINI_MODEL)?.trim();
    if (!model) {
      // Config/deploy mistake, not an upstream fault -> INTERNAL, not UPSTREAM.
      throw new LlmError(
        ErrorCode.INTERNAL,
        `${ENV.GEMINI_MODEL} is not set. Set it to a model the deploying project can access.`,
      );
    }

    const apiKey = this.#getEnv(ENV.GEMINI_API_KEY)?.trim();
    if (!apiKey) {
      throw new LlmError(ErrorCode.INTERNAL, `${ENV.GEMINI_API_KEY} is not set.`);
    }

    const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(policyText) }] }],
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Key travels in a header, not the URL, so it never lands in request logs.
          'x-goog-api-key': apiKey,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      // Network failure or timeout (abort) -> upstream.
      throw new LlmError(ErrorCode.UPSTREAM, 'Gemini request failed or timed out.', err);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // Read the body for server-side diagnostics only; do not surface it to clients.
      const detail = await safeText(res);
      throw new LlmError(
        ErrorCode.UPSTREAM,
        `Gemini returned HTTP ${res.status}.`,
        detail,
      );
    }

    let json: GenerateContentResponse;
    try {
      json = (await res.json()) as GenerateContentResponse;
    } catch (err) {
      throw new LlmError(ErrorCode.UPSTREAM, 'Gemini returned a non-JSON response.', err);
    }

    const tldr = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!tldr) {
      throw new LlmError(ErrorCode.UPSTREAM, 'Gemini response contained no text.', json);
    }

    return { tldr, model };
  }
}

/** Wraps the policy text in the summarization instruction. */
function buildPrompt(policyText: string): string {
  return [
    'Summarize the following privacy policy or terms document in plain English.',
    'Focus on what data is collected, how it is used and shared, and user rights.',
    'Be concise and neutral. Do not add information that is not in the text.',
    '',
    policyText,
  ].join('\n');
}

/** Reads a response body as text without throwing (best-effort, for logging). */
async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
