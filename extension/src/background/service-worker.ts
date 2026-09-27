/**
 * Service worker — orchestration, fetch, extraction, hashing, backend call.
 *
 * Owns everything after detection. On ANALYZE: SSRF-validate + fetch + extract
 * (Task 10), hash the normalized text (shared contentHash), then POST to
 * /analyze with client-owned retry (Task 12). MV3 workers are ephemeral and
 * hold no long-lived state.
 */

import { contentHash } from '@privvy/shared';
import type {
  ToWorkerMessage,
  FromWorkerMessage,
  FromContentMessage,
  ToContentMessage,
  DetectedLink,
} from '../types/messages.js';
import { extractPolicyText } from './extract.js';
import { analyzeWithRetry } from './analyze-client.js';

/** Ask the content script in a tab to detect policy links. */
async function detectInTab(tabId: number): Promise<DetectedLink[]> {
  const msg: ToContentMessage = { type: 'DETECT_POLICY_LINKS' };
  try {
    const res = (await chrome.tabs.sendMessage(tabId, msg)) as FromContentMessage | undefined;
    return res?.type === 'DETECTED_LINKS' ? res.links : [];
  } catch {
    // No content script in the tab (e.g. a chrome:// page or not yet injected).
    return [];
  }
}

/** Run the full analyze pipeline for a user-selected URL. */
async function analyze(url: string): Promise<FromWorkerMessage> {
  // Validate (SSRF guard) + fetch + extract. Extraction returns typed failures.
  const extraction = await extractPolicyText(url);
  if (!extraction.ok) {
    // These failures are deterministic for this URL; not worth a manual retry.
    const retryable = extraction.code === 'FETCH_FAILED';
    return { type: 'ERROR', message: extraction.message, retryable };
  }

  // Sanitized URL comes back from extraction; hash the normalized text.
  const hash = await contentHash(extraction.text);

  const outcome = await analyzeWithRetry({
    text: extraction.text,
    url: extraction.finalUrl,
    contentHash: hash,
  });

  if (outcome.ok) {
    return {
      type: 'ANALYSIS',
      flags: outcome.result.flags,
      summary: outcome.result.summary,
      model: outcome.result.model,
      cached: outcome.result.cached,
    };
  }
  return { type: 'ERROR', message: outcome.message, retryable: outcome.retryable };
}

chrome.runtime.onMessage.addListener((message: ToWorkerMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'DETECT': {
      detectInTab(message.tabId)
        .then((links) => {
          const response: FromWorkerMessage = { type: 'LINKS', links };
          sendResponse(response);
        })
        .catch(() => {
          sendResponse({ type: 'ERROR', message: "Couldn't scan this page.", retryable: true });
        });
      return true; // async response
    }
    case 'ANALYZE': {
      // Always respond, even if analyze() rejects unexpectedly (e.g. crypto.subtle
      // throwing), so the popup never hangs waiting on the channel.
      analyze(message.url)
        .then(sendResponse)
        .catch(() => {
          sendResponse({ type: 'ERROR', message: 'Something went wrong analyzing this page.', retryable: true });
        });
      return true; // async response
    }
    default:
      return false;
  }
});
