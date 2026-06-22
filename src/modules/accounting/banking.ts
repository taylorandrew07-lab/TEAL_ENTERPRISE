// Private bank register (treasury) — banks, real accounts + balances, statement
// uploads, transactions, and matching transactions to bills (expenses) / invoices
// (receivables). All gated by banking.private via RLS; statement files live in the
// private 'statements' bucket. This is the deterministic cross-reference foundation;
// document extraction (MarkItDown) and auto-matching layer on top of these tables.
'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountingDb } from './context';
import { parseDelimited } from './import-parse';
import type { TAccount, TBank, TTxn, TStatement, MatchTarget } from './banking-types';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => {
  const n = parseFloat(String(s).replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

function back(path: string, error?: string): never {
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------
export async function listBanks(): Promise<TBank[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const [{ data: banks }, { data: accounts }] = await Promise.all([
    acc.from('treasury_banks').select('id, name, note').eq('company_id', companyId).order('name'),
    acc
      .from('treasury_accounts')
      .select('id, bank_id, name, account_number, currency_code, current_balance, balance_as_of, gl_account_id')
      .eq('company_id', companyId)
      .order('name'),
  ]);
  const accByBank = new Map<string, TAccount[]>();
  for (const a of (accounts as any[] | null) ?? []) {
    const acct: TAccount = { ...a, current_balance: Number(a.current_balance || 0) };
    const arr = accByBank.get(a.bank_id) ?? [];
    arr.push(acct);
    accByBank.set(a.bank_id, arr);
  }
  return ((banks as any[] | null) ?? []).map((b) => ({ ...b, accounts: accByBank.get(b.id) ?? [] }));
}

export async function getAccount(id: string): Promise<(TAccount & { bank_name: string }) | null> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return null;
  const { data } = await acc
    .from('treasury_accounts')
    .select('id, bank_id, name, account_number, currency_code, current_balance, balance_as_of, gl_account_id, bank:treasury_banks(name)')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!data) return null;
  const a = data as any;
  return { ...a, current_balance: Number(a.current_balance || 0), bank_name: a.bank?.name ?? '—' };
}

export async function listTransactions(accountId: string): Promise<TTxn[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('treasury_transactions')
    .select('id, txn_date, description, amount, matched_bill_id, matched_invoice_id')
    .eq('company_id', companyId)
    .eq('account_id', accountId)
    .order('txn_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500);
  return ((data as any[] | null) ?? []).map((t) => ({ ...t, amount: Number(t.amount || 0) }));
}

export async function listStatements(accountId: string): Promise<TStatement[]> {
  const { acc, companyId, supabase } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('treasury_statements')
    .select('id, filename, storage_path, period_start, period_end, created_at')
    .eq('company_id', companyId)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });
  const rows = (data as any[] | null) ?? [];
  const paths = rows.map((r) => r.storage_path).filter(Boolean);
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from('statements').createSignedUrls(paths, 3600);
    for (const s of (signed as any[] | null) ?? []) if (s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    url: r.storage_path ? urlByPath.get(r.storage_path) ?? null : null,
    period_start: r.period_start,
    period_end: r.period_end,
    created_at: r.created_at,
  }));
}

/** Open bills (expenses) + invoices (receivables) to match a transaction against. */
export async function listMatchTargets(): Promise<MatchTarget[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const [{ data: bills }, { data: invoices }] = await Promise.all([
    acc.from('bills').select('id, bill_no, total, bill_date, due_date, status, supplier:suppliers(name)').eq('company_id', companyId).in('status', ['open', 'partial']).limit(300),
    acc.from('invoices').select('id, invoice_no, total, invoice_date, due_date, status, customer:customers(name)').eq('company_id', companyId).in('status', ['open', 'partial']).limit(300),
  ]);
  const out: MatchTarget[] = [];
  for (const b of (bills as any[] | null) ?? []) {
    out.push({
      value: `bill:${b.id}`,
      label: `Bill ${b.bill_no ?? ''} · ${b.supplier?.name ?? ''} · ${Number(b.total).toFixed(2)}`.replace(/\s+·\s+·/g, ' ·'),
      kind: 'bill',
      amount: Number(b.total || 0),
      date: b.due_date ?? b.bill_date,
    });
  }
  for (const i of (invoices as any[] | null) ?? []) {
    out.push({
      value: `invoice:${i.id}`,
      label: `Invoice ${i.invoice_no ?? ''} · ${i.customer?.name ?? ''} · ${Number(i.total).toFixed(2)}`.replace(/\s+·\s+·/g, ' ·'),
      kind: 'invoice',
      amount: Number(i.total || 0),
      date: i.due_date ?? i.invoice_date,
    });
  }
  return out;
}

export async function listCurrencyCodes(): Promise<string[]> {
  const { acc } = await accountingDb();
  const { data } = await acc.from('currencies').select('code').eq('is_active', true).order('code');
  return ((data as { code: string }[] | null) ?? []).map((c) => c.code);
}

export async function listGlAssetAccounts(): Promise<{ id: string; code: string; name: string }[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('accounts')
    .select('id, code, name, account_type:account_types!inner(category)')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('account_types.category', 'asset')
    .order('code');
  return ((data as any[] | null) ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name }));
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------
export async function addBank(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/banking', 'No active company');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) back('/accounting/banking', 'Bank name is required.');
  const { error } = await acc.from('treasury_banks').insert({ company_id: companyId, name });
  if (error) back('/accounting/banking', error.message);
  revalidatePath('/accounting/banking');
  back('/accounting/banking');
}

export async function addAccount(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/banking', 'No active company');
  const bank_id = String(formData.get('bank_id') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const currency_code = String(formData.get('currency_code') ?? '').trim().toUpperCase();
  const account_number = String(formData.get('account_number') ?? '').trim();
  const balance = num(String(formData.get('current_balance') ?? '0'));
  const gl = String(formData.get('gl_account_id') ?? '').trim();
  if (!bank_id) back('/accounting/banking', 'Choose a bank.');
  if (!name) back('/accounting/banking', 'Account name is required.');
  if (currency_code.length !== 3) back('/accounting/banking', 'Choose a currency.');
  const { error } = await acc.from('treasury_accounts').insert({
    company_id: companyId, bank_id, name, account_number: account_number || null, currency_code,
    current_balance: Number.isFinite(balance) ? round2(balance) : 0, balance_as_of: new Date().toISOString().slice(0, 10),
    gl_account_id: gl || null,
  });
  if (error) back('/accounting/banking', error.message);
  revalidatePath('/accounting/banking');
  back('/accounting/banking');
}

export async function updateBalance(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/banking');
  const id = String(formData.get('account_id') ?? '');
  const balance = num(String(formData.get('current_balance') ?? ''));
  const asOf = String(formData.get('balance_as_of') ?? '').trim();
  if (!id || !Number.isFinite(balance)) back(`/accounting/banking/${id}`, 'Enter a valid balance.');
  const { error } = await acc.from('treasury_accounts').update({ current_balance: round2(balance), balance_as_of: asOf || null }).eq('id', id).eq('company_id', companyId);
  if (error) back(`/accounting/banking/${id}`, error.message);
  revalidatePath(`/accounting/banking/${id}`);
  back(`/accounting/banking/${id}`);
}

export async function addTransaction(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/banking');
  const account_id = String(formData.get('account_id') ?? '');
  const txn_date = String(formData.get('txn_date') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const direction = String(formData.get('direction') ?? 'out'); // 'in' | 'out'
  const mag = num(String(formData.get('amount') ?? ''));
  if (!account_id || !txn_date || !Number.isFinite(mag) || mag <= 0) back(`/accounting/banking/${account_id}`, 'Enter a date and a positive amount.');
  const amount = round2(direction === 'in' ? mag : -mag);
  const { error } = await acc.from('treasury_transactions').insert({ company_id: companyId, account_id, txn_date, description: description || null, amount });
  if (error) back(`/accounting/banking/${account_id}`, error.message);
  revalidatePath(`/accounting/banking/${account_id}`);
  back(`/accounting/banking/${account_id}`);
}

export async function matchTransaction(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/banking');
  const txnId = String(formData.get('txn_id') ?? '');
  const accountId = String(formData.get('account_id') ?? '');
  const target = String(formData.get('target') ?? ''); // '' | 'bill:<id>' | 'invoice:<id>'
  const patch: { matched_bill_id: string | null; matched_invoice_id: string | null } = { matched_bill_id: null, matched_invoice_id: null };
  if (target.startsWith('bill:')) patch.matched_bill_id = target.slice(5);
  else if (target.startsWith('invoice:')) patch.matched_invoice_id = target.slice(8);
  const { error } = await acc.from('treasury_transactions').update(patch).eq('id', txnId).eq('company_id', companyId);
  if (error) back(`/accounting/banking/${accountId}`, error.message);
  revalidatePath(`/accounting/banking/${accountId}`);
  back(`/accounting/banking/${accountId}`);
}

export async function deleteTransaction(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/banking');
  const id = String(formData.get('id') ?? '');
  const accountId = String(formData.get('account_id') ?? '');
  if (id) await acc.from('treasury_transactions').delete().eq('id', id).eq('company_id', companyId);
  revalidatePath(`/accounting/banking/${accountId}`);
  back(`/accounting/banking/${accountId}`);
}

export async function deleteStatement(formData: FormData): Promise<void> {
  const { acc, companyId, supabase } = await accountingDb();
  if (!companyId) back('/accounting/banking');
  const id = String(formData.get('id') ?? '');
  const accountId = String(formData.get('account_id') ?? '');
  if (id) {
    const { data } = await acc.from('treasury_statements').select('storage_path').eq('id', id).eq('company_id', companyId).maybeSingle();
    if ((data as any)?.storage_path) await supabase.storage.from('statements').remove([(data as any).storage_path]);
    await acc.from('treasury_statements').delete().eq('id', id).eq('company_id', companyId);
  }
  revalidatePath(`/accounting/banking/${accountId}`);
  back(`/accounting/banking/${accountId}`);
}

export async function deleteAccount(formData: FormData): Promise<void> {
  const { acc, companyId, supabase } = await accountingDb();
  if (!companyId) back('/accounting/banking');
  const id = String(formData.get('id') ?? '');
  if (id) {
    const { data: stmts } = await acc.from('treasury_statements').select('storage_path').eq('account_id', id).eq('company_id', companyId);
    const paths = ((stmts as any[] | null) ?? []).map((s) => s.storage_path).filter(Boolean);
    if (paths.length) await supabase.storage.from('statements').remove(paths);
    await acc.from('treasury_accounts').delete().eq('id', id).eq('company_id', companyId); // cascades statements + transactions
  }
  revalidatePath('/accounting/banking');
  back('/accounting/banking');
}

export async function deleteBank(formData: FormData): Promise<void> {
  const { acc, companyId, supabase } = await accountingDb();
  if (!companyId) back('/accounting/banking');
  const id = String(formData.get('id') ?? '');
  if (id) {
    const { data: accts } = await acc.from('treasury_accounts').select('id').eq('bank_id', id).eq('company_id', companyId);
    const acctIds = ((accts as any[] | null) ?? []).map((a) => a.id);
    if (acctIds.length) {
      const { data: stmts } = await acc.from('treasury_statements').select('storage_path').in('account_id', acctIds);
      const paths = ((stmts as any[] | null) ?? []).map((s) => s.storage_path).filter(Boolean);
      if (paths.length) await supabase.storage.from('statements').remove(paths);
    }
    await acc.from('treasury_banks').delete().eq('id', id).eq('company_id', companyId); // cascades accounts → statements + transactions
  }
  revalidatePath('/accounting/banking');
  back('/accounting/banking');
}

/** Upload a statement: store the file privately, and best-effort parse CSV/TSV rows into transactions. */
export async function uploadStatement(formData: FormData): Promise<void> {
  const { acc, companyId, ctx, supabase } = await accountingDb();
  if (!companyId || !ctx.user) back('/accounting/banking');
  const accountId = String(formData.get('account_id') ?? '');
  const file = formData.get('file') as File | null;
  if (!accountId) back('/accounting/banking');
  if (!file || file.size === 0) back(`/accounting/banking/${accountId}`, 'Choose a statement file.');
  if (file.size > 26214400) back(`/accounting/banking/${accountId}`, 'File exceeds the 25 MB limit.');

  const stmtId = randomUUID();
  const safeName = (file.name || 'statement').replace(/[^\w.\- ]+/g, '_').trim().slice(0, 180) || 'statement';
  const path = `${companyId}/${stmtId}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage.from('statements').upload(path, buffer, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (upErr) back(`/accounting/banking/${accountId}`, upErr.message);

  const { data: stmt, error: sErr } = await acc
    .from('treasury_statements')
    .insert({ company_id: companyId, account_id: accountId, filename: file.name || safeName, storage_path: path, uploaded_by: ctx.user.id })
    .select('id')
    .single();
  if (sErr || !stmt) {
    await supabase.storage.from('statements').remove([path]);
    back(`/accounting/banking/${accountId}`, sErr?.message ?? 'Could not save the statement.');
  }

  // Best-effort: parse delimited (CSV/TSV) statements into transactions.
  const isText = /\.(csv|txt|tsv)$/i.test(file.name || '') || (file.type || '').includes('csv') || (file.type || '').includes('text');
  if (isText) {
    try {
      const text = buffer.toString('utf8');
      const parsed = parseDelimited(text);
      const find = (re: RegExp) => parsed.headers.findIndex((h) => re.test(h));
      const dateI = find(/date/i);
      const descI = find(/desc|narrat|detail|particular|memo|transaction/i);
      const amtI = find(/^amount$|^value$/i);
      const debitI = find(/debit|withdraw|paid\s*out|\bdr\b/i);
      const creditI = find(/credit|deposit|paid\s*in|\bcr\b/i);
      if (dateI >= 0 && (amtI >= 0 || debitI >= 0 || creditI >= 0)) {
        const rows: any[] = [];
        for (const r of parsed.rows) {
          const rawDate = (r[dateI] ?? '').trim();
          const d = new Date(rawDate);
          if (Number.isNaN(d.getTime())) continue;
          let amount = NaN;
          if (amtI >= 0) amount = num(r[amtI] ?? '');
          else {
            const dr = debitI >= 0 ? num(r[debitI] ?? '') : 0;
            const cr = creditI >= 0 ? num(r[creditI] ?? '') : 0;
            amount = (Number.isFinite(cr) ? cr : 0) - (Number.isFinite(dr) ? dr : 0);
          }
          if (!Number.isFinite(amount) || amount === 0) continue;
          rows.push({
            company_id: companyId, account_id: accountId, statement_id: (stmt as any).id,
            txn_date: d.toISOString().slice(0, 10),
            description: descI >= 0 ? (r[descI] ?? '').trim() || null : null,
            amount: round2(amount),
          });
        }
        if (rows.length > 0) await acc.from('treasury_transactions').insert(rows);
      }
    } catch {
      /* parsing is best-effort; the file is already stored */
    }
  }

  revalidatePath(`/accounting/banking/${accountId}`);
  back(`/accounting/banking/${accountId}`);
}
