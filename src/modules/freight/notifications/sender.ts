// Pluggable email sender for the freight outbound-email queue. In-app notifications
// work fully today; ACTUAL email delivery is deferred until an email provider is
// configured. The owner chose Microsoft 365 — until the M365/Graph connector exists
// (Azure app + mailbox addresses), the factory returns NoopSender, so emails simply
// stay 'queued' in freight.outbound_emails and nothing is sent.
import 'server-only';

export interface OutboundEmail {
  id: string;
  to_addresses: { name?: string; address: string }[];
  subject: string | null;
  body: string | null;
  attachment_document_ids: string[];
}

export type SendResult = { ok: true; providerId?: string } | { ok: false; error: string };

export interface EmailSender {
  readonly name: string;
  send(email: OutboundEmail): Promise<SendResult>;
}

/** Default: do nothing. Leaves the row 'queued' so it sends once a provider lands. */
class NoopSender implements EmailSender {
  readonly name = 'noop';
  async send(): Promise<SendResult> {
    return { ok: false, error: 'No email provider configured (queued for Microsoft 365).' };
  }
}

/** Placeholder for the Microsoft 365 / Graph sender — implemented when the Azure app
 *  + shared mailbox addresses are available. Drains the same queue. */
class M365GraphSender implements EmailSender {
  readonly name = 'm365';
  async send(): Promise<SendResult> {
    return { ok: false, error: 'Microsoft 365 connector not yet implemented.' };
  }
}

/** Selected by FREIGHT_EMAIL_PROVIDER. Defaults to noop (nothing sends). */
export function getEmailSender(): EmailSender {
  switch (process.env.FREIGHT_EMAIL_PROVIDER) {
    case 'm365':
      return new M365GraphSender();
    default:
      return new NoopSender();
  }
}
