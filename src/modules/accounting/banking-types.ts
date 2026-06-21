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
}
