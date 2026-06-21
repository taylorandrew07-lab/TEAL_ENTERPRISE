// Accounts Receivable: customers and sales invoices. Queries run through RLS as the
// current user (active company scopes every result); the 'use server' actions write
// customers, invoices + lines, and — when posting — a balanced journal entry that the
// DB posting function (post_journal_entry) finalises as the single source of truth.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountingDb } from './context';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export interface Customer {
  id: string;
  code: string;
  name: string;
  email: string | null;
  receivable_account_id: string | null;
  currency_code: string | null;
}

export type InvoiceStatus = 'draft' | 'open' | 'partial' | 'paid' | 'void';

export interface InvoiceRow {
  id: string;
  invoice_no: string | null;
  invoice_date: string;
  due_date: string | null;
  customer_id: string;
  customer_name: string;
  currency_code: string;
  total: number;
  status: InvoiceStatus;
}

export interface PostableAccount {
  id: string;
  code: string;
  name: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------
export async function listCustomers(): Promise<Customer[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('customers')
    .select('id, code, name, email, receivable_account_id, currency_code')
    .eq('company_id', companyId)
    .order('code');
  return (data as Customer[] | null) ?? [];
}

export async function listInvoices(): Promise<InvoiceRow[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const [{ data: invoices }, customers] = await Promise.all([
    acc
      .from('invoices')
      .select('id, invoice_no, invoice_date, due_date, customer_id, currency_code, total, status')
      .eq('company_id', companyId)
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200),
    listCustomers(),
  ]);
  const nameById = new Map(customers.map((c) => [c.id, c.name]));
  return ((invoices as any[] | null) ?? []).map((i) => ({
    id: i.id,
    invoice_no: i.invoice_no,
    invoice_date: i.invoice_date,
    due_date: i.due_date,
    customer_id: i.customer_id,
    customer_name: nameById.get(i.customer_id) ?? '—',
    currency_code: i.currency_code,
    total: Number(i.total || 0),
    status: i.status,
  }));
}

/** Active income accounts (revenue) — the credit side of a sales invoice. */
export async function listIncomeAccounts(): Promise<PostableAccount[]> {
  return accountsByCategory('income');
}

/** Active asset accounts (e.g. Accounts Receivable) — the debit/control side. */
export async function listReceivableAccounts(): Promise<PostableAccount[]> {
  return accountsByCategory('asset');
}

async function accountsByCategory(category: string): Promise<PostableAccount[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('accounts')
    .select('id, code, name, is_active, account_type:account_types!inner(category)')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('account_types.category', category)
    .order('code');
  return ((data as any[] | null) ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name }));
}

export async function companyBaseCurrencyAR(): Promise<string> {
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
function back(path: string, error?: string): never {
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

export async function addCustomer(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/customers', 'No active company');

  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const emailRaw = String(formData.get('email') ?? '').trim();
  const receivable_account_id = String(formData.get('receivable_account_id') ?? '').trim();
  if (!code || !name) back('/accounting/customers', 'Code and name are required');

  const base = await companyBaseCurrencyAR();
  const { error } = await acc.from('customers').insert({
    company_id: companyId,
    code,
    name,
    email: emailRaw || null,
    receivable_account_id: receivable_account_id || null,
    currency_code: base,
  });
  if (error) back('/accounting/customers', error.message);
  revalidatePath('/accounting/customers');
  back('/accounting/customers');
}

export interface InvoiceLineInput {
  accountId: string;
  description?: string;
  amount: number;
}

export interface CreateInvoiceInput {
  customerId: string;
  invoiceDate: string;
  dueDate?: string;
  receivableAccountId: string;
  lines: InvoiceLineInput[];
  post: boolean;
}

/**
 * Create a sales invoice (header + lines) and optionally post it. Returns { error }
 * so the client form can surface validation/engine errors without losing its state;
 * on success it redirects to the invoices list. When posting, a balanced journal is
 * assembled (Dr receivable for the total, Cr each income line) and handed to the DB
 * posting function, which is the final authority (period open, base-currency balance,
 * numbering). On success the invoice is linked to the entry and moved to 'open'.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<{ error?: string }> {
  const { acc, companyId, ctx } = await accountingDb();
  if (!companyId) return { error: 'No active company' };

  if (!input.customerId) return { error: 'Choose a customer.' };
  if (!input.invoiceDate) return { error: 'Choose an invoice date.' };
  if (!input.receivableAccountId) return { error: 'Choose a receivable (control) account.' };

  const lines = (input.lines ?? [])
    .map((l) => ({ accountId: l.accountId, description: l.description, amount: round2(Number(l.amount || 0)) }))
    .filter((l) => l.accountId && l.amount > 0);
  if (lines.length === 0) return { error: 'Add at least one income line with an amount.' };

  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  if (total <= 0) return { error: 'Invoice total must be greater than zero.' };

  const base = await companyBaseCurrencyAR();

  // 1) Invoice header (invoice_no left null — assigned by your numbering policy later).
  const { data: invoice, error: e1 } = await acc
    .from('invoices')
    .insert({
      company_id: companyId,
      customer_id: input.customerId,
      invoice_no: null,
      invoice_date: input.invoiceDate,
      due_date: input.dueDate?.trim() || null,
      currency_code: base,
      fx_rate: 1,
      status: 'draft',
      subtotal: total,
      tax_total: 0,
      total,
      base_total: total,
    })
    .select('id')
    .single();
  if (e1 || !invoice) return { error: e1?.message ?? 'Could not create the invoice.' };

  // 2) Invoice lines.
  const lineRows = lines.map((l, i) => ({
    company_id: companyId,
    invoice_id: invoice.id,
    line_no: i + 1,
    account_id: l.accountId,
    description: l.description?.trim() || null,
    quantity: 1,
    unit_price: l.amount,
    line_total: l.amount,
  }));
  const { error: e2 } = await acc.from('invoice_lines').insert(lineRows);
  if (e2) return { error: e2.message };

  // 3) Draft only — stop here.
  if (!input.post) {
    revalidatePath('/accounting/invoices');
    redirect('/accounting/invoices');
  }

  // 4) Assemble the balanced journal: Dr receivable (total), Cr each income line.
  const { data: entry, error: e3 } = await acc
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_date: input.invoiceDate,
      currency_code: base,
      description: 'Sales invoice',
      source: 'invoice',
      source_id: invoice.id,
      status: 'draft',
      created_by: ctx.user?.id ?? null,
    })
    .select('id')
    .single();
  if (e3 || !entry) return { error: e3?.message ?? 'Could not create the journal entry.' };

  const journalLines = [
    {
      company_id: companyId,
      journal_entry_id: entry.id,
      line_no: 1,
      account_id: input.receivableAccountId,
      description: 'Accounts receivable',
      debit: total,
      credit: 0,
      currency_code: base,
      fx_rate: 1,
      base_debit: total,
      base_credit: 0,
    },
    ...lines.map((l, i) => ({
      company_id: companyId,
      journal_entry_id: entry.id,
      line_no: i + 2,
      account_id: l.accountId,
      description: l.description?.trim() || 'Sales income',
      debit: 0,
      credit: l.amount,
      currency_code: base,
      fx_rate: 1,
      base_debit: 0,
      base_credit: l.amount,
    })),
  ];
  const { error: e4 } = await acc.from('journal_lines').insert(journalLines);
  if (e4) return { error: e4.message };

  // 5) Post via the DB engine (final authority).
  const { error: e5 } = await acc.rpc('post_journal_entry', { p_entry_id: entry.id });
  if (e5) return { error: e5.message };

  // 6) Link the entry and open the invoice.
  const { error: e6 } = await acc
    .from('invoices')
    .update({ journal_entry_id: entry.id, status: 'open' })
    .eq('id', invoice.id)
    .eq('company_id', companyId);
  if (e6) return { error: e6.message };

  revalidatePath('/accounting/invoices');
  redirect('/accounting/invoices');
}
