// Accounts Receivable: customers, sales invoices (with tax), and customer receipts.
// Queries run through RLS as the current user (active company scopes every result);
// the 'use server' actions write customers, invoices + lines, tax codes, payments, and
// — when posting — balanced journal entries that the DB posting function
// (post_journal_entry) finalises as the single source of truth.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountingDb, activeBaseCurrency } from './context';

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
  amount_paid: number;
  balance: number;
  status: InvoiceStatus;
}

export interface PostableAccount {
  id: string;
  code: string;
  name: string;
}

export interface TaxCode {
  id: string;
  code: string;
  name: string;
  rate: number;
  collected_account_id: string | null;
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
      .select('id, invoice_no, invoice_date, due_date, customer_id, currency_code, total, amount_paid, status')
      .eq('company_id', companyId)
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200),
    listCustomers(),
  ]);
  const nameById = new Map(customers.map((c) => [c.id, c.name]));
  return ((invoices as any[] | null) ?? []).map((i) => {
    const total = Number(i.total || 0);
    const paid = Number(i.amount_paid || 0);
    return {
      id: i.id,
      invoice_no: i.invoice_no,
      invoice_date: i.invoice_date,
      due_date: i.due_date,
      customer_id: i.customer_id,
      customer_name: nameById.get(i.customer_id) ?? '—',
      currency_code: i.currency_code,
      total,
      amount_paid: paid,
      balance: round2(total - paid),
      status: i.status,
    };
  });
}

/** Active income accounts (revenue) — the credit side of a sales invoice. */
export async function listIncomeAccounts(): Promise<PostableAccount[]> {
  return accountsByCategory('income');
}

/** Active asset accounts (e.g. Accounts Receivable) — the debit/control side. */
export async function listReceivableAccounts(): Promise<PostableAccount[]> {
  return accountsByCategory('asset');
}

/** Active liability accounts (e.g. VAT payable) — used as a tax code's collected account. */
export async function listLiabilityAccounts(): Promise<PostableAccount[]> {
  return accountsByCategory('liability');
}

/** Active bank GL accounts (flagged is_bank_account) — the debit side of a receipt. */
export async function listBankAccounts(): Promise<PostableAccount[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('accounts')
    .select('id, code, name')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('is_bank_account', true)
    .order('code');
  return ((data as any[] | null) ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name }));
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

export async function listTaxCodes(): Promise<TaxCode[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('tax_codes')
    .select('id, code, name, rate, collected_account_id, is_active')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('code');
  return ((data as any[] | null) ?? []).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    rate: Number(t.rate || 0),
    collected_account_id: t.collected_account_id,
  }));
}

export async function companyBaseCurrencyAR(): Promise<string> {
  return activeBaseCurrency();
}

export interface InvoiceLineDetail {
  description: string | null;
  account_name: string | null;
  tax_code: string | null;
  amount: number;
}
export interface PaymentRow {
  id: string;
  payment_no: string | null;
  payment_date: string;
  amount: number;
  reference: string | null;
}
export interface InvoiceDetail {
  id: string;
  invoice_no: string | null;
  invoice_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  currency_code: string;
  customer_name: string;
  subtotal: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  balance: number;
  notes: string | null;
  lines: InvoiceLineDetail[];
  payments: PaymentRow[];
}

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return null;
  const { data: inv } = await acc
    .from('invoices')
    .select(
      'id, invoice_no, invoice_date, due_date, status, currency_code, subtotal, tax_total, total, amount_paid, notes, customer:customers(name)',
    )
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!inv) return null;

  const [{ data: lines }, { data: payments }] = await Promise.all([
    acc
      .from('invoice_lines')
      .select('line_no, description, line_total, account:accounts(name), tax:tax_codes(code)')
      .eq('invoice_id', id)
      .order('line_no'),
    acc
      .from('payments')
      .select('id, payment_no, payment_date, amount, reference')
      .eq('invoice_id', id)
      .order('payment_date'),
  ]);

  const total = Number((inv as any).total || 0);
  const paid = Number((inv as any).amount_paid || 0);
  return {
    id: (inv as any).id,
    invoice_no: (inv as any).invoice_no,
    invoice_date: (inv as any).invoice_date,
    due_date: (inv as any).due_date,
    status: (inv as any).status,
    currency_code: (inv as any).currency_code,
    customer_name: (inv as any).customer?.name ?? '—',
    subtotal: Number((inv as any).subtotal || 0),
    tax_total: Number((inv as any).tax_total || 0),
    total,
    amount_paid: paid,
    balance: round2(total - paid),
    notes: (inv as any).notes ?? null,
    lines: ((lines as any[] | null) ?? []).map((l) => ({
      description: l.description,
      account_name: l.account?.name ?? null,
      tax_code: l.tax?.code ?? null,
      amount: Number(l.line_total || 0),
    })),
    payments: ((payments as any[] | null) ?? []).map((p) => ({
      id: p.id,
      payment_no: p.payment_no,
      payment_date: p.payment_date,
      amount: Number(p.amount || 0),
      reference: p.reference,
    })),
  };
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

export async function deleteCustomer(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/customers');
  const id = String(formData.get('id') ?? '');
  if (id) {
    const { error } = await acc.from('customers').delete().eq('id', id).eq('company_id', companyId);
    if (error) back('/accounting/customers', error.code === '23503' ? 'Can’t delete: this customer has invoices. Void those first.' : error.message);
  }
  revalidatePath('/accounting/customers');
  back('/accounting/customers');
}

export async function deleteTaxCode(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/tax-codes');
  const id = String(formData.get('id') ?? '');
  if (id) {
    const { error } = await acc.from('tax_codes').delete().eq('id', id).eq('company_id', companyId);
    if (error) back('/accounting/tax-codes', error.code === '23503' ? 'Can’t delete: this tax code is used on invoices.' : error.message);
  }
  revalidatePath('/accounting/tax-codes');
  back('/accounting/tax-codes');
}

export async function addTaxCode(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/tax-codes', 'No active company');

  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const ratePct = parseFloat(String(formData.get('rate') ?? ''));
  const collected = String(formData.get('collected_account_id') ?? '').trim();
  if (!code || !name) back('/accounting/tax-codes', 'Code and name are required.');
  if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) back('/accounting/tax-codes', 'Rate must be a percentage between 0 and 100.');

  const { error } = await acc.from('tax_codes').insert({
    company_id: companyId,
    code,
    name,
    rate: round2(ratePct) / 100, // store as fraction, e.g. 12.5% → 0.125
    tax_type: 'vat',
    collected_account_id: collected || null,
  });
  if (error) back('/accounting/tax-codes', error.message);
  revalidatePath('/accounting/tax-codes');
  back('/accounting/tax-codes');
}

export interface InvoiceLineInput {
  accountId: string;
  description?: string;
  amount: number;
  taxCodeId?: string;
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
 * Create a sales invoice (header + lines, with optional per-line tax) and optionally
 * post it. Returns { error } so the client form can surface validation/engine errors.
 * When posting: the invoice gets a document number (accounting.next_number), and a
 * balanced journal is assembled — Dr receivable for the gross total, Cr each income
 * line (net), Cr each tax code's collected (output VAT) account for the tax — then
 * handed to post_journal_entry (the final authority). On success the invoice is linked
 * to the entry and moved to 'open'.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<{ error?: string }> {
  const { acc, companyId, ctx } = await accountingDb();
  if (!companyId) return { error: 'No active company' };

  if (!input.customerId) return { error: 'Choose a customer.' };
  if (!input.invoiceDate) return { error: 'Choose an invoice date.' };
  if (!input.receivableAccountId) return { error: 'Choose a receivable (control) account.' };

  const cleaned = (input.lines ?? [])
    .map((l) => ({
      accountId: l.accountId,
      description: l.description,
      amount: round2(Number(l.amount || 0)),
      taxCodeId: l.taxCodeId || null,
    }))
    .filter((l) => l.accountId && l.amount > 0);
  if (cleaned.length === 0) return { error: 'Add at least one income line with an amount.' };

  // Resolve tax codes used, for rate + collected account.
  const taxCodes = await listTaxCodes();
  const taxById = new Map(taxCodes.map((t) => [t.id, t]));
  for (const l of cleaned) {
    if (l.taxCodeId) {
      const tc = taxById.get(l.taxCodeId);
      if (!tc) return { error: 'A selected tax code is no longer available.' };
      if (input.post && tc.rate > 0 && !tc.collected_account_id) {
        return { error: `Tax code ${tc.code} needs a "collected" (VAT payable) account before it can be posted. Set it in Tax Codes.` };
      }
    }
  }

  // Per-line net + tax; group tax by collected account for the journal.
  const taxByAccount = new Map<string, number>();
  let subtotal = 0;
  let taxTotal = 0;
  const withTax = cleaned.map((l) => {
    const tc = l.taxCodeId ? taxById.get(l.taxCodeId)! : null;
    const tax = tc ? round2(l.amount * tc.rate) : 0;
    subtotal = round2(subtotal + l.amount);
    taxTotal = round2(taxTotal + tax);
    if (tax > 0 && tc?.collected_account_id) {
      taxByAccount.set(tc.collected_account_id, round2((taxByAccount.get(tc.collected_account_id) ?? 0) + tax));
    }
    return { ...l, tax };
  });
  const total = round2(subtotal + taxTotal);
  if (total <= 0) return { error: 'Invoice total must be greater than zero.' };

  const base = await companyBaseCurrencyAR();

  // 1) Invoice header (draft; invoice_no assigned on post).
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
      subtotal,
      tax_total: taxTotal,
      total,
      base_total: total,
    })
    .select('id')
    .single();
  if (e1 || !invoice) return { error: e1?.message ?? 'Could not create the invoice.' };

  // 2) Invoice lines (line_total = net; tax tracked via tax_code_id).
  const lineRows = withTax.map((l, i) => ({
    company_id: companyId,
    invoice_id: invoice.id,
    line_no: i + 1,
    account_id: l.accountId,
    description: l.description?.trim() || null,
    quantity: 1,
    unit_price: l.amount,
    tax_code_id: l.taxCodeId,
    line_total: l.amount,
  }));
  const { error: e2 } = await acc.from('invoice_lines').insert(lineRows);
  if (e2) return { error: e2.message };

  // 3) Draft only — stop here.
  if (!input.post) {
    revalidatePath('/accounting/invoices');
    redirect('/accounting/invoices');
  }

  // 4) Assign a document number.
  const { data: invNo, error: eNum } = await acc.rpc('next_number', { p_company: companyId, p_key: 'invoice' });
  if (eNum) return { error: eNum.message };

  // 5) Assemble the balanced journal: Dr receivable (gross), Cr income (net), Cr tax (collected).
  const { data: entry, error: e3 } = await acc
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_date: input.invoiceDate,
      currency_code: base,
      description: `Sales invoice ${invNo ?? ''}`.trim(),
      source: 'invoice',
      source_id: invoice.id,
      status: 'draft',
      created_by: ctx.user?.id ?? null,
    })
    .select('id')
    .single();
  if (e3 || !entry) return { error: e3?.message ?? 'Could not create the journal entry.' };

  let lineNo = 1;
  const journalLines: any[] = [
    {
      company_id: companyId,
      journal_entry_id: entry.id,
      line_no: lineNo++,
      account_id: input.receivableAccountId,
      description: 'Accounts receivable',
      debit: total,
      credit: 0,
      currency_code: base,
      fx_rate: 1,
      base_debit: total,
      base_credit: 0,
    },
    ...withTax.map((l) => ({
      company_id: companyId,
      journal_entry_id: entry.id,
      line_no: lineNo++,
      account_id: l.accountId,
      description: l.description?.trim() || 'Sales income',
      debit: 0,
      credit: l.amount,
      currency_code: base,
      fx_rate: 1,
      base_debit: 0,
      base_credit: l.amount,
    })),
    ...[...taxByAccount.entries()].map(([accountId, amount]) => ({
      company_id: companyId,
      journal_entry_id: entry.id,
      line_no: lineNo++,
      account_id: accountId,
      description: 'Output tax (VAT)',
      debit: 0,
      credit: amount,
      currency_code: base,
      fx_rate: 1,
      base_debit: 0,
      base_credit: amount,
    })),
  ];
  const { error: e4 } = await acc.from('journal_lines').insert(journalLines);
  if (e4) return { error: e4.message };

  // 6) Post via the DB engine (final authority).
  const { error: e5 } = await acc.rpc('post_journal_entry', { p_entry_id: entry.id });
  if (e5) return { error: e5.message };

  // 7) Link the entry, number, and open the invoice.
  const { error: e6 } = await acc
    .from('invoices')
    .update({ journal_entry_id: entry.id, invoice_no: invNo, status: 'open' })
    .eq('id', invoice.id)
    .eq('company_id', companyId);
  if (e6) return { error: e6.message };

  revalidatePath('/accounting/invoices');
  redirect('/accounting/invoices');
}

export interface RecordPaymentInput {
  invoiceId: string;
  bankAccountId: string;
  amount: number;
  paymentDate: string;
  reference?: string;
}

/**
 * Record a customer receipt against an invoice: posts a balanced Dr bank / Cr
 * receivable journal (the receivable account is taken from the invoice's own posted
 * entry, never trusted from the client), records the payment, and advances the invoice
 * open → partial → paid. Returns { error } for the client form.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<{ error?: string }> {
  const { acc, companyId, ctx } = await accountingDb();
  if (!companyId) return { error: 'No active company' };
  if (!input.bankAccountId) return { error: 'Choose the bank account that received the money.' };
  if (!input.paymentDate) return { error: 'Choose the payment date.' };
  const amount = round2(Number(input.amount || 0));
  if (amount <= 0) return { error: 'Payment amount must be greater than zero.' };

  const { data: inv } = await acc
    .from('invoices')
    .select('id, customer_id, currency_code, total, amount_paid, status, journal_entry_id')
    .eq('id', input.invoiceId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!inv) return { error: 'Invoice not found.' };
  if (!(inv as any).journal_entry_id) return { error: 'Post the invoice before recording a payment.' };
  if (['paid', 'void', 'draft'].includes((inv as any).status)) return { error: `This invoice is ${(inv as any).status}; no payment is due.` };

  const balance = round2(Number((inv as any).total) - Number((inv as any).amount_paid));
  if (amount > balance + 0.005) return { error: `Payment exceeds the outstanding balance (${balance.toFixed(2)}).` };

  // Receivable account = the debit account of the invoice's posted entry.
  const { data: recvLine } = await acc
    .from('journal_lines')
    .select('account_id')
    .eq('journal_entry_id', (inv as any).journal_entry_id)
    .gt('debit', 0)
    .order('line_no')
    .limit(1)
    .maybeSingle();
  const receivableAccountId = (recvLine as any)?.account_id;
  if (!receivableAccountId) return { error: 'Could not determine the receivable account for this invoice.' };

  const base = (inv as any).currency_code as string;

  // 1) Receipt number.
  const { data: payNo, error: eNum } = await acc.rpc('next_number', { p_company: companyId, p_key: 'receipt' });
  if (eNum) return { error: eNum.message };

  // 2) Journal: Dr bank / Cr receivable.
  const { data: entry, error: e1 } = await acc
    .from('journal_entries')
    .insert({
      company_id: companyId,
      entry_date: input.paymentDate,
      currency_code: base,
      description: `Receipt ${payNo ?? ''}`.trim(),
      source: 'receipt',
      source_id: input.invoiceId,
      status: 'draft',
      created_by: ctx.user?.id ?? null,
    })
    .select('id')
    .single();
  if (e1 || !entry) return { error: e1?.message ?? 'Could not create the receipt entry.' };

  const { error: e2 } = await acc.from('journal_lines').insert([
    {
      company_id: companyId,
      journal_entry_id: entry.id,
      line_no: 1,
      account_id: input.bankAccountId,
      description: 'Bank receipt',
      debit: amount,
      credit: 0,
      currency_code: base,
      fx_rate: 1,
      base_debit: amount,
      base_credit: 0,
    },
    {
      company_id: companyId,
      journal_entry_id: entry.id,
      line_no: 2,
      account_id: receivableAccountId,
      description: 'Accounts receivable',
      debit: 0,
      credit: amount,
      currency_code: base,
      fx_rate: 1,
      base_debit: 0,
      base_credit: amount,
    },
  ]);
  if (e2) return { error: e2.message };

  const { error: e3 } = await acc.rpc('post_journal_entry', { p_entry_id: entry.id });
  if (e3) return { error: e3.message };

  // 3) Record the payment.
  const { error: e4 } = await acc.from('payments').insert({
    company_id: companyId,
    customer_id: (inv as any).customer_id,
    invoice_id: input.invoiceId,
    payment_no: payNo,
    payment_date: input.paymentDate,
    amount,
    currency_code: base,
    bank_account_id: input.bankAccountId,
    journal_entry_id: entry.id,
    reference: input.reference?.trim() || null,
    created_by: ctx.user?.id ?? null,
  });
  if (e4) return { error: e4.message };

  // 4) Advance the invoice.
  const newPaid = round2(Number((inv as any).amount_paid) + amount);
  const newStatus = newPaid >= round2(Number((inv as any).total)) - 0.005 ? 'paid' : 'partial';
  const { error: e5 } = await acc
    .from('invoices')
    .update({ amount_paid: newPaid, status: newStatus })
    .eq('id', input.invoiceId)
    .eq('company_id', companyId);
  if (e5) return { error: e5.message };

  revalidatePath('/accounting/invoices');
  revalidatePath(`/accounting/invoices/${input.invoiceId}`);
  return {};
}
