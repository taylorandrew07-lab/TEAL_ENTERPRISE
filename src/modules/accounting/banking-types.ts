// Shared types for the private bank register. Kept out of the 'use server' module
// (which may only export async functions) so the UI and server actions share them.
export interface TAccount {
  id: string;
  bank_id: string;
  name: string;
  account_number: string | null;
  currency_code: string;
  current_balance: number;
  balance_as_of: string | null;
  gl_account_id: string | null;
}
export interface TBank {
  id: string;
  name: string;
  note: string | null;
  accounts: TAccount[];
}
export interface TTxn {
  id: string;
  txn_date: string;
  description: string | null;
  amount: number;
  matched_bill_id: string | null;
  matched_invoice_id: string | null;
}
export interface TStatement {
  id: string;
  filename: string | null;
  url: string | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}
export interface MatchTarget {
  value: string; // 'bill:<id>' | 'invoice:<id>'
  label: string;
  kind?: 'bill' | 'invoice';
  amount?: number;
  date?: string;
}

/**
 * Deterministic match suggestion (no AI): an open item of the right kind (money out →
 * bill, money in → invoice) whose total is within 0.5% of the transaction amount,
 * nearest by date. Pure amount/date reconciliation.
 */
export function suggestMatch(
  txn: { amount: number; txn_date: string; matched_bill_id: string | null; matched_invoice_id: string | null },
  items: MatchTarget[],
): MatchTarget | null {
  if (txn.matched_bill_id || txn.matched_invoice_id) return null;
  const wantKind = txn.amount < 0 ? 'bill' : 'invoice';
  const target = Math.abs(txn.amount);
  const t = Date.parse(txn.txn_date);
  const cands = items.filter(
    (i) => i.kind === wantKind && typeof i.amount === 'number' && Math.abs(i.amount - target) <= Math.max(0.01, i.amount * 0.005),
  );
  if (cands.length === 0) return null;
  const dist = (i: MatchTarget) => (i.date ? Math.abs(Date.parse(i.date) - t) : Number.MAX_SAFE_INTEGER);
  cands.sort((a, b) => dist(a) - dist(b));
  return cands[0];
}
