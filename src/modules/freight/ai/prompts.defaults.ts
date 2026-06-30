// Default prompt templates (editable per company once installed). Plain data so the
// settings UI can offer "install defaults". {{var}} placeholders are filled from a
// task's input object by the runner. Owner-editable: no code change to tune the AI.
export interface DefaultPrompt { name: string; template: string; variables: string[] }

export const DEFAULT_PROMPTS: Record<string, DefaultPrompt> = {
  summarise_status: {
    name: 'Summarise shipment status',
    template:
      'You are a freight-forwarding operations assistant for Jupiter Logistics. Given the shipment context below, write a concise, plain-language status update a customer or colleague can understand in seconds. State where the shipment is, what has happened, what is next, and flag any risk (free-time/demurrage, delays, missing documents). Do not invent facts.\n\nShipment context:\n{{context}}',
    variables: ['context'],
  },
  draft_communication: {
    name: 'Draft a message',
    template:
      'You are drafting a professional message on behalf of Jupiter Logistics. Audience: {{audience}}. Purpose: {{purpose}}. Use the shipment context for facts; keep it courteous and concise. Output only the message body.\n\nShipment context:\n{{context}}',
    variables: ['audience', 'purpose', 'context'],
  },
  draft_customer_quote: {
    name: 'Draft customer quotation',
    template:
      'You are preparing a customer freight quotation for Jupiter Logistics. Using the supplier costs and shipment details below, propose customer-facing charge lines (description, quantity, unit, rate) and a sensible margin. Be commercially reasonable; never quote below cost. Return structured data only.\n\nSupplier costs & shipment:\n{{context}}',
    variables: ['context'],
  },
};
