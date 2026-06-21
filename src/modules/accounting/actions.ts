// Write-side server actions for the Accounting module. Mutations go through RLS
// (writes require the relevant permission; super admin bypasses). On failure we
// redirect back with an ?error= so the screen can surface it.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountingDb } from './context';

function back(path: string, error?: string): never {
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

export async function createAccount(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/accounts', 'No active company');
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const account_type_id = String(formData.get('account_type_id') ?? '');
  const is_bank_account = formData.get('is_bank_account') === 'on';
  if (!code || !name || !account_type_id) back('/accounting/accounts', 'Code, name and type are required');

  const { error } = await acc
    .from('accounts')
    .insert({ company_id: companyId, code, name, account_type_id, is_bank_account });
  if (error) back('/accounting/accounts', error.message);
  revalidatePath('/accounting/accounts');
  back('/accounting/accounts');
}

// A pragmatic Trinidad & Tobago starter chart, mapped to the seeded account types.
const STARTER_CHART: { code: string; name: string; typeKey: string; bank?: boolean }[] = [
  { code: '1000', name: 'Cash at Bank', typeKey: 'bank', bank: true },
  { code: '1010', name: 'Petty Cash', typeKey: 'current_asset' },
  { code: '1100', name: 'Accounts Receivable', typeKey: 'accounts_receivable' },
  { code: '1200', name: 'Prepaid Expenses', typeKey: 'current_asset' },
  { code: '1500', name: 'Equipment & Vehicles', typeKey: 'fixed_asset' },
  { code: '1510', name: 'Accumulated Depreciation', typeKey: 'fixed_asset' },
  { code: '2000', name: 'Accounts Payable', typeKey: 'accounts_payable' },
  { code: '2100', name: 'VAT Payable', typeKey: 'tax_liability' },
  { code: '2200', name: 'PAYE Payable', typeKey: 'tax_liability' },
  { code: '2300', name: 'NIS Payable', typeKey: 'tax_liability' },
  { code: '2500', name: 'Loans Payable', typeKey: 'long_term_liability' },
  { code: '3000', name: 'Share Capital', typeKey: 'equity' },
  { code: '3100', name: 'Retained Earnings', typeKey: 'retained_earnings' },
  { code: '4000', name: 'Service Revenue', typeKey: 'income' },
  { code: '4100', name: 'Survey & Assurance Revenue', typeKey: 'income' },
  { code: '4900', name: 'Other Income', typeKey: 'other_income' },
  { code: '5000', name: 'Cost of Services', typeKey: 'cost_of_goods_sold' },
  { code: '6000', name: 'Salaries & Wages', typeKey: 'expense' },
  { code: '6100', name: 'Rent', typeKey: 'expense' },
  { code: '6200', name: 'Utilities', typeKey: 'expense' },
  { code: '6300', name: 'Office Expenses', typeKey: 'expense' },
  { code: '6400', name: 'Professional Fees', typeKey: 'expense' },
  { code: '6500', name: 'Bank Charges', typeKey: 'expense' },
  { code: '6900', name: 'Depreciation', typeKey: 'expense' },
  { code: '7000', name: 'Other Expenses', typeKey: 'other_expense' },
];

export async function seedStarterChart(): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/accounts', 'No active company');

  const { data: types } = await acc.from('account_types').select('id, key');
  const idByKey = new Map((types ?? []).map((t: { id: string; key: string }) => [t.key, t.id]));

  const rows = STARTER_CHART.filter((a) => idByKey.has(a.typeKey)).map((a) => ({
    company_id: companyId,
    code: a.code,
    name: a.name,
    account_type_id: idByKey.get(a.typeKey)!,
    is_bank_account: Boolean(a.bank),
  }));

  const { error } = await acc.from('accounts').insert(rows);
  if (error) back('/accounting/accounts', error.message);
  revalidatePath('/accounting/accounts');
  back('/accounting/accounts');
}

// ---- Periods ----------------------------------------------------------------

export async function createFiscalYear(formData: FormData): Promise<void> {
  const { acc, supabase, companyId } = await accountingDb();
  if (!companyId) back('/accounting/periods', 'No active company');
  const year = parseInt(String(formData.get('year') ?? ''), 10);
  if (!year || year < 1900 || year > 2200) back('/accounting/periods', 'Enter a valid year');

  const { data: comp } = await supabase
    .schema('core')
    .from('companies')
    .select('fiscal_year_start_month')
    .eq('id', companyId)
    .maybeSingle();
  const startMonth: number = comp?.fiscal_year_start_month ?? 1;

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const rows = Array.from({ length: 12 }, (_, i) => {
    const offset = startMonth - 1 + i;
    const monthIndex = offset % 12;
    const y = year + Math.floor(offset / 12);
    const start = new Date(Date.UTC(y, monthIndex, 1));
    const end = new Date(Date.UTC(y, monthIndex + 1, 0));
    const name = `${start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${y}`;
    return {
      company_id: companyId,
      fiscal_year: year,
      period_no: i + 1,
      name,
      start_date: fmt(start),
      end_date: fmt(end),
      status: 'open' as const,
    };
  });

  const { error } = await acc.from('accounting_periods').insert(rows);
  if (error) back('/accounting/periods', error.message);
  revalidatePath('/accounting/periods');
  back('/accounting/periods');
}

export async function setPeriodStatus(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/periods', 'No active company');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !['open', 'closed', 'locked'].includes(status)) back('/accounting/periods', 'Invalid request');

  const { error } = await acc
    .from('accounting_periods')
    .update({ status })
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) back('/accounting/periods', error.message);
  revalidatePath('/accounting/periods');
  back('/accounting/periods');
}

// ---- Journal entries --------------------------------------------------------

export interface JournalLineInput {
  accountId: string;
  description?: string;
  debit: number;
  credit: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Create a journal entry (+ lines) and optionally post it. Returns { error } so the
 * client form can surface validation/engine errors without losing its state. On
 * success it redirects to the journals list. The DB posting function is the final
 * authority (balance in txn + base currency, open period, numbering).
 */
export async function postJournalEntry(input: {
  entryDate: string;
  currency: string;
  description: string;
  lines: JournalLineInput[];
  post: boolean;
}): Promise<{ error?: string }> {
  const { acc, companyId, ctx } = await accountingDb();
  if (!companyId) return { error: 'No active company' };

  const lines = (input.lines ?? []).filter(
    (l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0),
  );
  if (lines.length < 2) return { error: 'Add at least two lines, each with a debit or a credit.' };
  for (const l of lines) {
    if (Number(l.debit) > 0 && Number(l.credit) > 0) {
      return { error: 'A line cannot have both a debit and a credit.' };
    }
  }
  const sumD = round2(lines.reduce((s, l) => s + Number(l.debit || 0), 0));
  const sumC = round2(lines.reduce((s, l) => s + Number(l.credit || 0), 0));
  if (sumD === 0) return { error: 'Entry has zero value.' };
  if (sumD !== sumC) return { error: `Entry is not balanced — debits ${sumD} ≠ credits ${sumC}.` };

  const currency = input.currency || 'TTD';
  const { data: entry, error: e1 } = await acc
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_date: input.entryDate,
      currency_code: currency,
      description: input.description?.trim() || null,
      source: 'manual',
      status: 'draft',
      created_by: ctx.user?.id ?? null,
    })
    .select('id')
    .single();
  if (e1 || !entry) return { error: e1?.message ?? 'Could not create the entry.' };

  const lineRows = lines.map((l, i) => ({
    company_id: companyId,
    journal_entry_id: entry.id,
    line_no: i + 1,
    account_id: l.accountId,
    description: l.description?.trim() || null,
    debit: round2(Number(l.debit || 0)),
    credit: round2(Number(l.credit || 0)),
    currency_code: currency,
    fx_rate: 1,
    base_debit: round2(Number(l.debit || 0)),
    base_credit: round2(Number(l.credit || 0)),
  }));
  const { error: e2 } = await acc.from('journal_lines').insert(lineRows);
  if (e2) return { error: e2.message };

  if (input.post) {
    const { error: e3 } = await acc.rpc('post_journal_entry', { p_entry_id: entry.id });
    if (e3) return { error: e3.message };
  }

  revalidatePath('/accounting/journals');
  redirect('/accounting/journals');
}

export async function reverseJournalEntry(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/journals', 'No active company');
  const id = String(formData.get('id') ?? '');
  if (!id) back('/accounting/journals', 'Invalid request');
  const { error } = await acc.rpc('reverse_journal_entry', { p_entry_id: id });
  if (error) back('/accounting/journals', error.message);
  revalidatePath('/accounting/journals');
  back('/accounting/journals');
}
