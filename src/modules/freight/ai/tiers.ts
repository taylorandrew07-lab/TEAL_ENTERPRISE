// Model tiering + the AI task catalogue. Pure data (no server-only) so the settings
// UI can import the labels/catalogue. Most freight AI work is simple and defaults to
// the CHEAP tier — premium is reserved for genuinely hard, multi-step reasoning.
// Every task ships mode 'off': nothing runs until an admin enables it AND a key exists.

export type AITier = 'cheap' | 'standard' | 'premium';
export type AIMode = 'off' | 'suggest' | 'auto';

export interface AIJobType {
  key: string;
  label: string;
  description: string;
  defaultTier: AITier;
  readOnly?: boolean; // produces text only (no proposed write actions → no approval)
}

// The catalogue of AI tasks. Job types match freight.ai_jobs.job_type + freight.prompts.key.
export const AI_JOB_TYPES: AIJobType[] = [
  { key: 'summarise_status',       label: 'Summarise shipment status',  description: 'A plain-language status summary for a shipment.',          defaultTier: 'cheap',    readOnly: true },
  { key: 'extract_document',       label: 'Extract document fields',     description: 'Pull structured fields (refs, dates, parties) from a document/text.', defaultTier: 'cheap',    readOnly: true },
  { key: 'compare_supplier_quotes',label: 'Compare supplier quotes',     description: 'Compare received supplier quotes and highlight the best option.', defaultTier: 'standard', readOnly: true },
  { key: 'recommend_next_action',  label: 'Recommend next action',       description: 'Suggest the next operational step for a shipment.',        defaultTier: 'standard', readOnly: true },
  { key: 'draft_communication',    label: 'Draft a message',             description: 'Draft a customer/supplier email or note for review.',      defaultTier: 'standard' },
  { key: 'draft_delay_notice',     label: 'Draft delay notice',          description: 'Draft a delay/ETA-change notice to the customer.',         defaultTier: 'standard' },
  { key: 'draft_rfq',              label: 'Draft supplier RFQ',          description: 'Compose a request-for-quote to suppliers/carriers.',       defaultTier: 'standard' },
  { key: 'draft_customer_quote',   label: 'Draft customer quotation',    description: 'Build a customer quotation (lines + margin) from supplier quotes.', defaultTier: 'premium' },
];

export const JOB_TYPE_BY_KEY = new Map(AI_JOB_TYPES.map((t) => [t.key, t]));

// Default model per tier. A single provider is used across tiers so ONE key works out
// of the box; every task is overridable per-company in the AI settings screen.
export const TIER_MODEL: Record<AITier, { provider: string; model: string }> = {
  cheap:    { provider: 'openai', model: 'gpt-4o-mini' },
  standard: { provider: 'openai', model: 'gpt-4o' },
  premium:  { provider: 'openai', model: 'gpt-4o' },
};

export const TIER_LABELS: Record<AITier, string> = {
  cheap: 'Cheap / fast', standard: 'Standard', premium: 'Premium',
};
export const MODE_LABELS: Record<AIMode, string> = {
  off: 'Off (humans only)', suggest: 'Suggest (AI drafts → approval)', auto: 'Auto (AI acts)',
};
