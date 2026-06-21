// Accounts Payable: suppliers + bills that post to the ledger (the AP mirror of AR).
// Read-side queries run through RLS scoped to the active company; the write-side
// actions assemble a balanced journal entry and let the DB posting function be the
// final authority (balance gate, open period, numbering). Import accountingDb only.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountingDb } from './context';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export interface Supplier {
  id: string;
  code: string;
  name: string;
  email: string | null;
  currency_code: string | null;
  payable_account_id: string | null;
  is_active: boolean;
}

export interface BillRow {
  id: string;
  bill_no: string | null;
  bill_date: string;
  due_date: string | null;
  status: 'draft' | 'open' | 'partial' | 'paid' | 'void';
  currency_code: string;
  total: number;
  supplier_id: string;
  supplier_name: string;
  journal_entry_id: string | null;
}

export interface PostableAccount {
  id: string;
  code: string;
  name: string;
  type_key: string;
  type_name: string;
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------
export async function listSuppliers(): Promise<Supplier[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('suppliers')
    .select('id, code, name, email, currency_code, payable_account_id, is_active')
    .eq('company_id', companyId)
    .order('code');
  return (data as Supplier[] | null) ?? [];
}

export async function listBills(): Promise<BillRow[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];

  const [{ data: bills }, suppliers] = await Promise.all([
    acc
      .from('bills')
      .select('id, bill_no, bill_date, due_date, status, currency_code, total, supplier_id, journal_entry_id')
      .eq('company_id', companyId)
      .order('bill_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200),
    listSuppliers(),
  ]);

  const nameById = new Map(suppliers.map((s) => [s.id, s.name]));
  return ((bills as any[] | null) ?? []).map((b) => ({
    id: b.id,
    bill_no: b.bill_no,
    bill_date: b.bill_date,
    due_date: b.due_date,
    status: b.status,
    currency_code: b.currency_code,
    total: Number(b.total || 0),
    supplier_id: b.supplier_id,
    supplier_name: nameById.get(b.supplier_id) ?? 'Unknown supplier',
    journal_entry_id: b.journal_entry_id,
  }));
}

/** Active accounts whose type category is 'expense' (expense / COGS / other expense). */
export async function listExpenseAccounts(): Promise<PostableAccount[]> {
  return accountsByCategory('expense');
}

/** Active accounts whose type category is 'liability' (e.g. Accounts Payable). */
export async function listPayableAccounts(): Promise<PostableAccount[]> {
  return accountsByCategory('liability');
}

async function accountsByCategory(category: 'expense' | 'liability'): Promise<PostableAccount[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('accounts')
    .select('id, code, name, account_type:account_types!inner(key, name, category)')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('account_types.category', category)
    .order('code');
  return ((data as any[] | null) ?? []).map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type_key: a.account_type?.key ?? '',
    type_name: a.account_type?.name ?? '',
  }));
}

export async function companyBaseCurrencyAP(): Promise<string> {
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

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------
const round2 = (n: number) => Math.round(n * 100) / 100;

function back(path: string, error?: string): never {
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

/** Create a supplier (subledger master + AP control account). */
export async function addSupplier(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/suppliers', 'No active company');

  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const payable_account_id = String(formData.get('payable_account_id') ?? '').trim();
  if (!code || !name) back('/accounting/suppliers', 'Code and name are required');

  const baseCurrency = await companyBaseCurrencyAP();

  const { error } = await acc.from('suppliers').insert({
    company_id: companyId,
    code,
    name,
    email: email || null,
    payable_account_id: payable_account_id || null,
    currency_code: baseCurrency,
  });
  if (error) back('/accounting/suppliers', error.message);
  revalidatePath('/accounting/suppliers');
  back('/accounting/suppliers');
}

export interface BillLineInput {
  accountId: string;
  description?: string;
  amount: number;
}

/**
 * Create a bill (+ lines) and optionally post it. When posting we assemble the
 * journal entry — Dr each expense line, Cr the payable control for the total —
 * insert it, then call the DB posting function (the authority on balance, period
 * and numbering). On success we link the entry and mark the bill 'open'. Returns
 * { error } so the client form can surface problems without losing its state.
 */
export async function createBill(input: {
  supplierId: string;
  billDate: string;
  dueDate?: string;
  payableAccountId: string;
  lines: BillLineInput[];
  post: boolean;
}): Promise<{ error?: string }> {
  const { acc, companyId, ctx } = await accountingDb();
  if (!companyId) return { error: 'No active company' };

  if (!input.supplierId) return { error: 'Choose a supplier.' };
  if (!input.billDate) return { error: 'A bill date is required.' };
  if (!input.payableAccountId) return { error: 'Choose a payable (accounts payable) account.' };

  const lines = (input.lines ?? []).filter((l) => l.accountId && Number(l.amount) > 0);
  if (lines.length < 1) return { error: 'Add at least one expense line with an amount.' };

  const total = round2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
  if (total <= 0) return { error: 'The bill total must be greater than zero.' };

  const currency = await companyBaseCurrencyAP();

  // 1) Insert the bill header.
  const { data: bill, error: e1 } = await acc
    .from('bills')
    .insert({
      company_id: companyId,
      supplier_id: input.supplierId,
      bill_date: input.billDate,
      due_date: input.dueDate || null,
      currency_code: currency,
      status: 'draft',
      subtotal: total,
      tax_total: 0,
      total,
      base_total: total,
    })
    .select('id')
    .single();
  if (e1 || !bill) return { error: e1?.message ?? 'Could not create the bill.' };

  // 2) Insert the bill lines.
  const billLineRows = lines.map((l, i) => ({
    company_id: companyId,
    bill_id: bill.id,
    line_no: i + 1,
    account_id: l.accountId,
    description: l.description?.trim() || null,
    quantity: 1,
    unit_price: round2(Number(l.amount || 0)),
    line_total: round2(Number(l.amount || 0)),
  }));
  const { error: e2 } = await acc.from('bill_lines').insert(billLineRows);
  if (e2) return { error: e2.message };

  // 3) If not posting, leave it as a draft document.
  if (!input.post) {
    revalidatePath('/accounting/bills');
    redirect('/accounting/bills');
  }

  // 4) Assemble the journal entry: Dr each expense line, Cr the payable control.
  const { data: entry, error: e3 } = await acc
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_date: input.billDate,
      currency_code: currency,
      description: 'Supplier bill',
      source: 'bill',
      source_id: bill.id,
      status: 'draft',
      created_by: ctx.user?.id ?? null,
    })
    .select('id')
    .single();
  if (e3 || !entry) return { error: e3?.message ?? 'Could not create the journal entry.' };

  const journalLineRows = [
    ...lines.map((l, i) => ({
      company_id: companyId,
      journal_entry_id: entry.id,
      line_no: i + 1,
      account_id: l.accountId,
      description: l.description?.trim() || null,
      debit: round2(Number(l.amount || 0)),
      credit: 0,
      currency_code: currency,
      fx_rate: 1,
      base_debit: round2(Number(l.amount || 0)),
      base_credit: 0,
    })),
    {
      company_id: companyId,
      journal_entry_id: entry.id,
      line_no: lines.length + 1,
      account_id: input.payableAccountId,
      description: 'Accounts payable',
      debit: 0,
      credit: total,
      currency_code: currency,
      fx_rate: 1,
      base_debit: 0,
      base_credit: total,
    },
  ];
  const { error: e4 } = await acc.from('journal_lines').insert(journalLineRows);
  if (e4) return { error: e4.message };

  // 5) Post via the DB function (final authority), then link + open the bill.
  const { error: e5 } = await acc.rpc('post_journal_entry', { p_entry_id: entry.id });
  if (e5) return { error: e5.message };

  const { error: e6 } = await acc
    .from('bills')
    .update({ journal_entry_id: entry.id, status: 'open' })
    .eq('id', bill.id)
    .eq('company_id', companyId);
  if (e6) return { error: e6.message };

  revalidatePath('/accounting/bills');
  redirect('/accounting/bills');
}
