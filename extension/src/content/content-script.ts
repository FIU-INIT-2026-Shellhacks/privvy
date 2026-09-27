/**
 * Content script — detection only.
 *
 * Runs in the visited page's context. Its sole job is to read the live DOM and
 * find policy links, then return them to the service worker. It never fetches,
 * extracts, or calls the backend (that is the worker's job; see the design's
 * CSP/SSRF rationale).
 *
 * Detection logic lives in ./detect.ts; this entry just routes the
 * DETECT_POLICY_LINKS message to it and returns the result.
 */

import type { ToContentMessage, FromContentMessage } from '../types/messages.js';
import { detectPolicyLinks } from './detect.js';

chrome.runtime.onMessage.addListener(
  (message: ToContentMessage, _sender, sendResponse) => {
    if (message.type === 'DETECT_POLICY_LINKS') {
      const response: FromContentMessage = {
        type: 'DETECTED_LINKS',
        links: detectPolicyLinks(),
      };
      sendResponse(response);
    }
    // Synchronous response; no need to return true.
    return false;
  },
);
