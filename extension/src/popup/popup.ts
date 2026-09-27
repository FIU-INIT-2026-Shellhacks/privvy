/**
 * Popup UI state machine (Task 13).
 *
 * Flow: idle -> detecting -> link list -> (user selects) -> analyzing ->
 * result (TLDR) | error. Analysis never starts until the user picks a link
 * (SSRF guard). The manual Retry button appears only when the worker reports a
 * retryable failure; retry starts a fresh analyze call (one layer of retry —
 * the automatic layer lives in the worker, per decision #15).
 *
 * All content is inserted via textContent / DOM nodes (never innerHTML with
 * fetched strings) to stay MV3-CSP-safe and avoid injecting untrusted text.
 */

import type {
  ToWorkerMessage,
  FromWorkerMessage,
  DetectedLink,
} from '../types/messages.js';

const main = document.getElementById('pv-main') as HTMLElement;

/** Send a message to the service worker and await its typed reply. */
function askWorker(message: ToWorkerMessage): Promise<FromWorkerMessage> {
  return chrome.runtime.sendMessage(message) as Promise<FromWorkerMessage>;
}

/** Clear the main view. */
function clear(): void {
  main.replaceChildren();
}

/** Small helper to build an element with class + text. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderStatus(text: string, withSpinner = false): void {
  clear();
  const p = el('p', 'pv-status');
  if (withSpinner) {
    p.appendChild(el('span', 'pv-spinner'));
  }
  p.appendChild(document.createTextNode(text));
  main.appendChild(p);
}

function renderNoPolicy(): void {
  clear();
  main.appendChild(el('p', 'pv-status', 'No privacy policy or terms links found on this page.'));
}

function renderLinks(links: DetectedLink[]): void {
  clear();
  main.appendChild(el('p', 'pv-status', 'Pick a document to summarize:'));
  const list = el('ul', 'pv-link-list');
  for (const link of links) {
    const li = el('li');
    const btn = el('button', 'pv-link-btn');
    btn.appendChild(el('span', 'pv-link-text', link.text || link.url));
    btn.appendChild(el('span', 'pv-link-url', link.url));
    btn.addEventListener('click', () => startAnalysis(link.url));
    li.appendChild(btn);
    list.appendChild(li);
  }
  main.appendChild(list);
}

function renderResult(tldr: string, model: string, cached: boolean): void {
  clear();
  const panel = el('div', 'pv-tldr', tldr);
  main.appendChild(panel);
  const meta = el('p', 'pv-meta', `Summarized by ${model}`);
  if (cached) {
    meta.appendChild(el('span', 'pv-badge', 'from cache'));
  }
  main.appendChild(meta);

  const actions = el('div', 'pv-actions');
  const back = el('button', 'pv-btn pv-btn-secondary', 'Back');
  back.addEventListener('click', detect);
  actions.appendChild(back);
  main.appendChild(actions);
}

function renderError(message: string, retryable: boolean, retryUrl?: string): void {
  clear();
  main.appendChild(el('p', 'pv-error', message));
  const actions = el('div', 'pv-actions');
  if (retryable && retryUrl) {
    const retry = el('button', 'pv-btn pv-btn-primary', 'Retry');
    retry.addEventListener('click', () => startAnalysis(retryUrl));
    actions.appendChild(retry);
  }
  const back = el('button', 'pv-btn pv-btn-secondary', 'Back');
  back.addEventListener('click', detect);
  actions.appendChild(back);
  main.appendChild(actions);
}

/** Analyze a selected URL: show loading, call worker, render outcome. */
async function startAnalysis(url: string): Promise<void> {
  renderStatus('Reading and summarizing the policy…', true);
  let reply: FromWorkerMessage;
  try {
    reply = await askWorker({ type: 'ANALYZE', url });
  } catch {
    renderError("Couldn't reach Privvy's background service.", true, url);
    return;
  }
  if (reply.type === 'ANALYSIS') {
    renderResult(reply.tldr, reply.model, reply.cached);
  } else if (reply.type === 'ERROR') {
    renderError(reply.message, reply.retryable, url);
  } else {
    renderError('Unexpected response.', false);
  }
}

/** Detect policy links in the active tab. */
async function detect(): Promise<void> {
  renderStatus('Scanning this page for policies…', true);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    renderError('No active tab to scan.', false);
    return;
  }
  let reply: FromWorkerMessage;
  try {
    reply = await askWorker({ type: 'DETECT', tabId: tab.id });
  } catch {
    renderError("Couldn't reach Privvy's background service.", true);
    return;
  }
  if (reply.type === 'LINKS') {
    if (reply.links.length === 0) renderNoPolicy();
    else renderLinks(reply.links);
  } else {
    renderError('Unexpected response.', false);
  }
}

document.addEventListener('DOMContentLoaded', detect);
