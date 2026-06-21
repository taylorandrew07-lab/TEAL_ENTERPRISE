// Foreign exchange + private management overlay (Trinidad reality):
//  - Official bank rates (accounting.exchange_rates) feed the books; managed here.
//  - PRIVATE parallel-market rates (accounting.parallel_rates) record the real rate
//    you transact USD at, with the spread vs official — gated by private.view.
//  - VAT position: output (payable) vs input (recoverable) VAT, net, and an aging of
//    the hard-to-recover input VAT — also private.
// All reads/writes run under the user's session + RLS.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountingDb } from './context';

const round = (n: number, d = 2) => {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
};

function back(path: string, error?: string): never {
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

async function baseCurrency(): Promise<string> {
  const { supabase, companyId } = await accountingDb();
  if (!companyId) return 'TTD';
  const { data } = await supabase.schema('core').from('companies').select('base_currency_code').eq('id', companyId).maybeSingle();
  return data?.base_currency_code ?? 'TTD';
}

// -----------------------------------------------------------------------------
// Official exchange rates (feed the books)
// -----------------------------------------------------------------------------
export interface ExchangeRateRow {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  rate_date: string;
  source: string | null;
}

export async function listExchangeRates(): Promise<ExchangeRateRow[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  const { data } = await acc
    .from('exchange_rates')
    .select('id, from_currency, to_currency, rate, rate_date, source')
    .eq('company_id', companyId)
    .order('rate_date', { ascending: false })
    .limit(200);
  return ((data as any[] | null) ?? []).map((r) => ({ ...r, rate: Number(r.rate) }));
}

export async function listCurrencyCodes(): Promise<string[]> {
  const { acc } = await accountingDb();
  const { data } = await acc.from('currencies').select('code').eq('is_active', true).order('code');
  return ((data as { code: string }[] | null) ?? []).map((c) => c.code);
}

export async function addExchangeRate(formData: FormData): Promise<void> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) back('/accounting/exchange-rates', 'No active company');
  const from = String(formData.get('from_currency') ?? '').trim().toUpperCase();
  const to = String(formData.get('to_currency') ?? '').trim().toUpperCase();
  const rate = parseFloat(String(formData.get('rate') ?? ''));
  const rate_date = String(formData.get('rate_date') ?? '').trim();
  if (from.length !== 3 || to.length !== 3) back('/accounting/exchange-rates', 'Pick both currencies.');
  if (from === to) back('/accounting/exchange-rates', 'Currencies must differ.');
  if (!Number.isFinite(rate) || rate <= 0) back('/accounting/exchange-rates', 'Rate must be greater than zero.');
  if (!rate_date) back('/accounting/exchange-rates', 'Pick a date.');
  const { error } = await acc.from('exchange_rates').insert({ company_id: companyId, from_currency: from, to_currency: to, rate, rate_date, source: 'bank' });
  if (error) back('/accounting/exchange-rates', error.message);
  revalidatePath('/accounting/exchange-rates');
  back('/accounting/exchange-rates');
}

// -----------------------------------------------------------------------------
// Private parallel-market rates + spread
// -----------------------------------------------------------------------------
export interface ParallelRateRow {
  id: string;
  rate_date: string;
  from_currency: string;
  to_currency: string;
  official_rate: number;
  parallel_rate: number;
  spread: number;
  spread_pct: number;
  note: string | null;
}

export async function listParallelRates(): Promise<ParallelRateRow[]> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return [];
  // RLS (private.view) silently returns nothing if the user lacks access.
  const { data } = await acc
    .from('parallel_rates')
    .select('id, rate_date, from_currency, to_currency, official_rate, parallel_rate, note')
    .eq('company_id', companyId)
    .order('rate_date', { ascending: false })
    .limit(200);
  return ((data as any[] | null) ?? []).map((r) => {
    const off = Number(r.official_rate);
    const par = Number(r.parallel_rate);
    return {
      id: r.id,
      rate_date: r.rate_date,
      from_currency: r.from_currency,
      to_currency: r.to_currency,
      official_rate: off,
      parallel_rate: par,
      spread: round(par - off, 4),
      spread_pct: off > 0 ? round(((par - off) / off) * 100, 2) : 0,
      note: r.note,
    };
  });
}

export async function addParallelRate(formData: FormData): Promise<void> {
  const { acc, companyId, ctx } = await accountingDb();
  if (!companyId) back('/accounting/parallel-rates', 'No active company');
  const from = String(formData.get('from_currency') ?? '').trim().toUpperCase();
  const to = String(formData.get('to_currency') ?? '').trim().toUpperCase();
  const official = parseFloat(String(formData.get('official_rate') ?? ''));
  const parallel = parseFloat(String(formData.get('parallel_rate') ?? ''));
  const rate_date = String(formData.get('rate_date') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  if (from.length !== 3 || to.length !== 3 || from === to) back('/accounting/parallel-rates', 'Pick two different currencies.');
  if (!Number.isFinite(official) || official <= 0) back('/accounting/parallel-rates', 'Official rate must be greater than zero.');
  if (!Number.isFinite(parallel) || parallel <= 0) back('/accounting/parallel-rates', 'Parallel rate must be greater than zero.');
  if (!rate_date) back('/accounting/parallel-rates', 'Pick a date.');
  const { error } = await acc.from('parallel_rates').insert({
    company_id: companyId, rate_date, from_currency: from, to_currency: to,
    official_rate: official, parallel_rate: parallel, note: note || null, created_by: ctx.user?.id ?? null,
  });
  if (error) back('/accounting/parallel-rates', error.message);
  revalidatePath('/accounting/parallel-rates');
  back('/accounting/parallel-rates');
}

// -----------------------------------------------------------------------------
// VAT position (output vs input/recoverable) — private overlay
// -----------------------------------------------------------------------------
export interface VatPosition {
  configured: boolean;
  currency: string;
  payable: number;      // output VAT collected, owed to the BIR
  recoverable: number;  // input VAT paid, claimable from the BIR (often stuck)
  net: number;          // payable - recoverable
  recoverableByMonth: { month: string; amount: number }[];
}

export async function vatPosition(): Promise<VatPosition> {
  const { acc, companyId } = await accountingDb();
  const currency = await baseCurrency();
  const empty: VatPosition = { configured: false, currency, payable: 0, recoverable: 0, net: 0, recoverableByMonth: [] };
  if (!companyId) return empty;

  const { data: taxCodes } = await acc
    .from('tax_codes')
    .select('collected_account_id, paid_account_id')
    .eq('company_id', companyId);
  const collected = new Set<string>();
  const paid = new Set<string>();
  for (const t of (taxCodes as any[] | null) ?? []) {
    if (t.collected_account_id) collected.add(t.collected_account_id);
    if (t.paid_account_id) paid.add(t.paid_account_id);
  }
  if (collected.size === 0 && paid.size === 0) return empty;

  const accountIds = [...collected, ...paid];
  const { data: gl } = await acc
    .from('general_ledger')
    .select('account_id, entry_date, base_debit, base_credit')
    .in('account_id', accountIds);

  let payable = 0;
  let recoverable = 0;
  const byMonth = new Map<string, number>();
  for (const l of (gl as any[] | null) ?? []) {
    const d = Number(l.base_debit || 0);
    const c = Number(l.base_credit || 0);
    if (collected.has(l.account_id)) payable += c - d; // liability: credit-positive
    if (paid.has(l.account_id)) {
      const amt = d - c; // asset: debit-positive
      recoverable += amt;
      const month = String(l.entry_date).slice(0, 7); // YYYY-MM
      byMonth.set(month, round((byMonth.get(month) ?? 0) + amt, 2));
    }
  }

  return {
    configured: true,
    currency,
    payable: round(payable, 2),
    recoverable: round(recoverable, 2),
    net: round(payable - recoverable, 2),
    recoverableByMonth: [...byMonth.entries()]
      .filter(([, amt]) => Math.abs(amt) > 0.005)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, amount]) => ({ month, amount })),
  };
}
