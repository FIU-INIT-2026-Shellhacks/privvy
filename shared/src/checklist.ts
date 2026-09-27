/**
 * The fixed privacy-risk checklist (from the requirements).
 *
 * The backend evaluates a policy against these items and returns the ones that apply
 * as `flags` in the /analyze response. Kept in the shared package so the checklist is
 * a single source of truth (the prompt references it, and any future deterministic
 * rating would map these same items to a score).
 *
 * The LLM only decides which items APPLY (fact extraction); it does not compute a
 * rating — that stays deterministic if/when added.
 */

export interface ChecklistItem {
  /** Stable id for the risk. */
  id: string;
  /** Short human-readable danger statement, phrased for a non-lawyer. */
  label: string;
  /** Guidance for the model on what triggers this flag. */
  criterion: string;
}

export const RISK_CHECKLIST: readonly ChecklistItem[] = [
  {
    id: 'sells_shares_data',
    label: 'Sells or shares your data with third parties',
    criterion: 'The policy allows selling, renting, or sharing personal data with third parties, advertisers, partners, or data brokers.',
  },
  {
    id: 'trains_ai',
    label: 'Uses your content to train AI',
    criterion: 'The policy permits using your content, data, or activity to train machine-learning or AI models.',
  },
  {
    id: 'indefinite_retention',
    label: 'Keeps your data indefinitely or unclearly',
    criterion: 'Data is retained indefinitely, for an unspecified period, or the retention period is vague.',
  },
  {
    id: 'hard_to_delete',
    label: 'Makes it hard to delete your data or account',
    criterion: 'There is no clear way to delete your data or account, or deletion is burdensome or conditional.',
  },
  {
    id: 'forced_arbitration',
    label: 'Forces arbitration or waives class actions',
    criterion: 'The terms require binding arbitration or waive the right to join a class-action lawsuit.',
  },
  {
    id: 'broad_content_license',
    label: 'Takes a broad license to your content',
    criterion: 'You grant a broad, perpetual, or irrevocable license to content you create or upload.',
  },
  {
    id: 'cross_site_tracking',
    label: 'Tracks you across other sites',
    criterion: 'The policy describes tracking your activity across other websites or apps, e.g. via cookies, pixels, or ad networks.',
  },
  {
    id: 'no_opt_out',
    label: "Doesn't let you opt out of data collection",
    criterion: 'There is no mechanism to decline or opt out of data collection, sharing, or targeted advertising.',
  },
] as const;
