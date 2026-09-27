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
import { RISK_CHECKLIST } from '../../../shared/dist/checklist.js';
import { LlmError, type LlmProvider, type Summary } from './provider.ts';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Shape of the subset of the generateContent response we read. */
interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

/** The structured JSON we ask Gemini to return (and validate on the way back). */
interface AnalysisJson {
  flags?: unknown;
  summary?: unknown;
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
    this.#getEnv = opts.getEnv ??
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
      // Ask for structured JSON so we get { flags, summary } reliably, not prose/markdown.
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            flags: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
          required: ['flags', 'summary'],
        },
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    // Keep the timeout armed across BOTH the fetch AND the body read: fetch resolves
    // once headers arrive, but res.json()/safeText read the body afterward. Clearing
    // the timer too early would let a stalled body hang summarize() forever. One
    // try/finally wraps everything so the abort still rejects a stalled body read.
    try {
      const res = await this.#fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Key travels in a header, not the URL, so it never lands in request logs.
          'x-goog-api-key': apiKey,
        },
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        // Read the body for server-side diagnostics only; never surface it to clients.
        const detail = await safeText(res);
        throw new LlmError(ErrorCode.UPSTREAM, `Gemini returned HTTP ${res.status}.`, detail);
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch (err) {
        throw new LlmError(ErrorCode.UPSTREAM, 'Gemini returned a non-JSON response.', err);
      }

      // Guard the response shape before property access: res.json() may return a valid
      // JSON `null` (or a non-object), which would otherwise throw a raw TypeError that
      // escapes the LlmError mapping.
      if (json === null || typeof json !== 'object') {
        throw new LlmError(
          ErrorCode.UPSTREAM,
          'Gemini returned an unexpected response shape.',
          json,
        );
      }

      const rawText = (json as GenerateContentResponse).candidates?.[0]?.content?.parts?.[0]?.text
        ?.trim();
      if (!rawText) {
        throw new LlmError(ErrorCode.UPSTREAM, 'Gemini response contained no text.', json);
      }

      // The response text is JSON (responseMimeType), but validate it defensively.
      let parsed: AnalysisJson;
      try {
        parsed = JSON.parse(rawText) as AnalysisJson;
      } catch (err) {
        throw new LlmError(ErrorCode.UPSTREAM, 'Gemini returned unparseable analysis JSON.', err);
      }

      const flags = Array.isArray(parsed.flags)
        ? parsed.flags.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
            .map((f) => f.trim())
        : [];
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
      if (!summary) {
        throw new LlmError(ErrorCode.UPSTREAM, 'Gemini analysis had no summary.', parsed);
      }

      return { flags, summary, model };
    } catch (err) {
      // Re-throw our typed errors unchanged; wrap everything else (network failure,
      // abort/timeout) as UPSTREAM.
      if (err instanceof LlmError) throw err;
      throw new LlmError(ErrorCode.UPSTREAM, 'Gemini request failed or timed out.', err);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Build the analysis prompt: check the policy against the fixed risk checklist and
 * return danger flags plus a short summary. Danger-focused (lead with risks), plain
 * text only (no markdown), summary capped at ~5 lines.
 */
function buildPrompt(policyText: string): string {
  const checklist = RISK_CHECKLIST.map((item) => `- ${item.label}: ${item.criterion}`).join('\n');
  return [
    'You are Privvy, a privacy watchdog. Analyze the privacy policy or terms document',
    'below and warn the user about risks BEFORE they agree to it. Focus on danger, not',
    'a neutral overview.',
    '',
    'Check the document against this fixed risk checklist. Include a flag ONLY when the',
    'document genuinely triggers that item based on its actual text:',
    checklist,
    '',
    'Return JSON with exactly two fields:',
    '- "flags": an array of short plain-English danger statements, one per checklist item',
    '  that applies. Phrase each as a direct warning to the user (e.g. "This site sells',
    '  your data to third parties", "You cannot opt out of tracking"). If nothing risky',
    '  applies, return an empty array.',
    '- "summary": a plain-English overview of at most 5 short lines. No markdown, no',
    '  bullet characters, no asterisks — plain sentences only. Lead with what matters',
    '  most to the user\'s privacy.',
    '',
    'Do not invent anything not supported by the document text. Plain text only.',
    '',
    'DOCUMENT:',
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
