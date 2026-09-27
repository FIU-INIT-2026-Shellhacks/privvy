/**
 * Internal message types passed between the extension's own components
 * (popup <-> service worker <-> content script). Distinct from the shared
 * `/analyze` backend contract in @privvy/shared.
 */

/** A policy link detected on the page by the content script (Task 9). */
export interface DetectedLink {
  /** Absolute, resolved URL of the policy document. */
  url: string;
  /** Visible link text as shown on the page. */
  text: string;
}

/** Messages the popup or worker sends to the content script. */
export type ToContentMessage = { type: 'DETECT_POLICY_LINKS' };

/** Messages the content script returns. */
export type FromContentMessage = {
  type: 'DETECTED_LINKS';
  links: DetectedLink[];
};

/** Messages the popup sends to the service worker. */
export type ToWorkerMessage =
  | { type: 'DETECT'; tabId: number }
  | { type: 'ANALYZE'; url: string };

/** Messages the service worker returns to the popup. */
export type FromWorkerMessage =
  | { type: 'LINKS'; links: DetectedLink[] }
  | { type: 'ANALYSIS'; flags: string[]; summary: string; model: string; cached: boolean }
  | {
      type: 'ERROR';
      message: string;
      /**
       * Whether the popup should offer a manual "Retry" affordance. True for
       * transient failures the user can sensibly retry (rate limit, network,
       * exhausted auto-retries). False for terminal failures where retrying
       * cannot help (validation, unsupported format, SSRF-blocked).
       */
      retryable: boolean;
    };
