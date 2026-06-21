// Read-side data access for the Accounting module (server components). All queries
// run through RLS as the current user; the active company scopes every result.
import { accountingDb } from './context';

export type AccountCategory = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type NormalBalance = 'debit' | 'credit';

export interface AccountType {
  id: string;
  key: string;
  name: string;
  category: AccountCategory;
  normal_balance: NormalBalance;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  is_bank_account: boolean;
  account_type_id: string;
  account_type: { name: string; category: AccountCategory; normal_balance: NormalBalance } | null;
}

export async function listAccountTypes(): Promise<AccountType[]> {
  const { acc } = await accountingDb();
  const { data } = await acc
    .from('account_types')
    .select('id, key, name, category, normal_balance')
    .order('category')
    .order('name');
  return (data as AccountType[] | null) ?? [];
}

export async function listAccounts(): Promise<Account[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('accounts')
    .select(
      'id, code, name, is_active, is_bank_account, account_type_id, account_type:account_types(name, category, normal_balance)',
    )
    .eq('company_id', companyId)
    .order('code');
  return (data as unknown as Account[] | null) ?? [];
}

export interface JournalEntryRow {
  id: string;
  entry_no: string | null;
  entry_date: string;
  description: string | null;
  status: 'draft' | 'posted' | 'void';
  currency_code: string;
  total: number;
}

export async function listJournalEntries(): Promise<JournalEntryRow[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('journal_entries')
    .select('id, entry_no, entry_date, description, status, currency_code, lines:journal_lines(debit)')
    .eq('company_id', companyId)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);
  return ((data as any[] | null) ?? []).map((e) => ({
    id: e.id,
    entry_no: e.entry_no,
    entry_date: e.entry_date,
    description: e.description,
    status: e.status,
    currency_code: e.currency_code,
    total: (e.lines ?? []).reduce((s: number, l: { debit: number }) => s + Number(l.debit || 0), 0),
  }));
}

export async function listPostableAccounts(): Promise<{ id: string; code: string; name: string }[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('accounts')
    .select('id, code, name')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('code');
  return (data as { id: string; code: string; name: string }[] | null) ?? [];
}

export async function companyBaseCurrency(): Promise<string> {
  const { supabase, companyId } = await accountingDb();
  if (!companyId) return 'TTD';
  const { data } = await supabase
    .schema('core')
    .from('companies')
    .select('base_currency_code')
    .eq('id', companyId)
    .maybeSingle();
  return data?.base_currency_code ?? 'TTD';
}

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  category: AccountCategory;
  debit: number;
  credit: number;
}

/** Trial balance from the general_ledger view (posted lines only), in base currency. */
export async function trialBalance(): Promise<{ rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number }> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return { rows: [], totalDebit: 0, totalCredit: 0 };
  const { data } = await acc
    .from('general_ledger')
    .select('account_id, account_code, account_name, account_category, base_debit, base_credit')
    .eq('company_id', companyId);

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const map = new Map<string, { account_code: string; account_name: string; category: AccountCategory; debit: number; credit: number }>();
  for (const row of (data as any[] | null) ?? []) {
    let m = map.get(row.account_id);
    if (!m) {
      m = { account_code: row.account_code, account_name: row.account_name, category: row.account_category, debit: 0, credit: 0 };
      map.set(row.account_id, m);
    }
    m.debit += Number(row.base_debit || 0);
    m.credit += Number(row.base_credit || 0);
  }

  const rows: TrialBalanceRow[] = [...map.values()]
    .map((m) => {
      const net = r2(m.debit - m.credit);
      return { account_code: m.account_code, account_name: m.account_name, category: m.category, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => a.account_code.localeCompare(b.account_code));

  return {
    rows,
    totalDebit: r2(rows.reduce((s, r) => s + r.debit, 0)),
    totalCredit: r2(rows.reduce((s, r) => s + r.credit, 0)),
  };
}

export type PeriodStatus = 'open' | 'closed' | 'locked';
export interface Period {
  id: string;
  fiscal_year: number;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: PeriodStatus;
}

export async function listPeriods(): Promise<Period[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('accounting_periods')
    .select('id, fiscal_year, period_no, name, start_date, end_date, status')
    .eq('company_id', companyId)
    .order('fiscal_year', { ascending: false })
    .order('period_no');
  return (data as Period[] | null) ?? [];
}

export function groupPeriodsByYear(periods: Period[]): { year: number; periods: Period[] }[] {
  const years = [...new Set(periods.map((p) => p.fiscal_year))].sort((a, b) => b - a);
  return years.map((year) => ({ year, periods: periods.filter((p) => p.fiscal_year === year) }));
}

const CATEGORY_ORDER: AccountCategory[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export function groupAccountsByCategory(accounts: Account[]): { category: AccountCategory; accounts: Account[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    accounts: accounts.filter((a) => a.account_type?.category === category),
  })).filter((g) => g.accounts.length > 0);
}
