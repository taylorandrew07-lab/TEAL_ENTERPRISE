// Inter-company transfers: post LINKED, balanced journal entries in TWO companies
// of the group, using Due-from / Due-to control accounts, and record the pair so
// the movement can be traced and (later) eliminated on consolidation.
//
// v1 is SAME-CURRENCY: both companies are assumed to share a base currency and
// every line posts at fx_rate 1 with base_* mirroring the transaction amounts.
// Multi-currency (per-leg translation, an inter-company FX rate) is a follow-up.
//
// Both legs are posted through the DB engine (post_journal_entry), the single
// authority for balance, period-open and numbering. The same user posts into both
// companies via RLS, so they must be an active member of BOTH — enforced here and
// by the core.intercompany_transfers write policy. company_id is set explicitly on
// every insert (A or B) because accountingDb() carries the active company but the
// engine/RLS let a member of both write to either.
'use server';

import { revalidatePath } from 'next/cache';
import { accountingDb } from './context';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export interface IntercompanyTransferRow {
  id: string;
  from_company_id: string;
  to_company_id: string;
  from_company_name: string;
  to_company_name: string;
  direction: 'out' | 'in'; // relative to the active company
  amount: number;
  currency_code: string;
  transfer_date: string;
  description: string | null;
  from_entry_id: string | null;
  to_entry_id: string | null;
  created_at: string;
}

export interface CompanyOption {
  id: string;
  name: string;
}

export interface CompanyAccount {
  id: string;
  code: string;
  name: string;
  category: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

/**
 * Transfers where the active company is the source OR the destination. Company
 * names are joined in JS from the session context (the only companies a user can
 * see), keeping the query a single read of the linking table.
 */
export async function listIntercompanyTransfers(): Promise<IntercompanyTransferRow[]> {
  const { supabase, companyId, ctx } = await accountingDb();
  if (!companyId) return [];

  const core = supabase.schema('core');
  const { data } = await core
    .from('intercompany_transfers')
    .select(
      'id, from_company_id, to_company_id, from_entry_id, to_entry_id, amount, currency_code, transfer_date, description, created_at',
    )
    .or(`from_company_id.eq.${companyId},to_company_id.eq.${companyId}`)
    .order('transfer_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);

  const nameById = new Map(ctx.companies.map((c) => [c.id, c.name]));

  return ((data as any[] | null) ?? []).map((t) => ({
    id: t.id,
    from_company_id: t.from_company_id,
    to_company_id: t.to_company_id,
    from_company_name: nameById.get(t.from_company_id) ?? '—',
    to_company_name: nameById.get(t.to_company_id) ?? '—',
    direction: t.from_company_id === companyId ? 'out' : 'in',
    amount: Number(t.amount || 0),
    currency_code: t.currency_code,
    transfer_date: t.transfer_date,
    description: t.description,
    from_entry_id: t.from_entry_id,
    to_entry_id: t.to_entry_id,
    created_at: t.created_at,
  }));
}

/** Companies the user can act in, excluding the active one (the transfer destinations). */
export async function listOtherCompanies(): Promise<CompanyOption[]> {
  const { ctx, companyId } = await accountingDb();
  return ctx.companies
    .filter((c) => c.id !== companyId)
    .map((c) => ({ id: c.id, name: c.name }));
}

/**
 * Active accounts for a given company, optionally filtered to an account category
 * (asset/liability/equity/income/expense). RLS allows reading accounts of any
 * company the user is a member of, so this serves both the active company (A) and
 * the chosen destination (B). Returns [] if companyId is not one the user can see.
 */
export async function accountsForCompany(
  companyId: string,
  category?: string,
): Promise<CompanyAccount[]> {
  if (!companyId) return [];
  const { ctx, acc } = await accountingDb();
  // Only expose accounts of companies the user actually belongs to.
  if (!ctx.isSuperAdmin && !ctx.companies.some((c) => c.id === companyId)) return [];

  let query = acc
    .from('accounts')
    .select('id, code, name, is_active, account_type:account_types!inner(category)')
    .eq('company_id', companyId)
    .eq('is_active', true);
  if (category) query = query.eq('account_types.category', category);

  const { data } = await query.order('code');
  return ((data as any[] | null) ?? []).map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    category: a.account_type?.category ?? '',
  }));
}

/** Base currency for a company the user can see (used to label / stamp the transfer). */
async function companyBaseCurrency(companyId: string): Promise<string | null> {
  const { supabase } = await accountingDb();
  const { data } = await supabase
    .schema('core')
    .from('companies')
    .select('base_currency_code')
    .eq('id', companyId)
    .maybeSingle();
  return data?.base_currency_code ?? null;
}

// -----------------------------------------------------------------------------
// Action
// -----------------------------------------------------------------------------
export interface CreateIntercompanyTransferInput {
  toCompanyId: string;
  fromCreditAccountId: string; // e.g. Bank in A (credited — money leaves A)
  fromDueFromAccountId: string; // Due-from-B, an asset in A (debited)
  toDebitAccountId: string; // e.g. Bank in B (debited — money arrives in B)
  toDueToAccountId: string; // Due-to-A, a liability in B (credited)
  amount: number;
  transferDate: string;
  description?: string;
}

/**
 * Post a balanced inter-company transfer across two companies and link the pair.
 *
 *   In A (active):   Dr Due-from-B      Cr Bank/source     (amount)
 *   In B (chosen):   Dr Bank/dest       Cr Due-to-A        (amount)
 *
 * Each leg is a manual journal entry posted via post_journal_entry; both companies
 * need an OPEN period covering transfer_date (the engine error is surfaced verbatim).
 * Returns { error } so the client form can keep its state; on success it revalidates
 * the transfers list and returns {} (the form navigates).
 */
export async function createIntercompanyTransfer(
  input: CreateIntercompanyTransferInput,
): Promise<{ error?: string }> {
  const { acc, supabase, companyId: fromCompanyId, ctx } = await accountingDb();
  if (!fromCompanyId) return { error: 'No active company.' };

  const toCompanyId = input.toCompanyId;
  if (!toCompanyId) return { error: 'Choose a destination company.' };
  if (toCompanyId === fromCompanyId) return { error: 'The destination must be a different company.' };

  // The user must be able to act in BOTH companies (also enforced by RLS).
  const canActIn = (id: string) => ctx.isSuperAdmin || ctx.companies.some((c) => c.id === id);
  if (!canActIn(fromCompanyId) || !canActIn(toCompanyId)) {
    return { error: 'You must belong to both companies to record an inter-company transfer.' };
  }

  if (!input.fromCreditAccountId) return { error: 'Choose the source (credit) account in this company.' };
  if (!input.fromDueFromAccountId) return { error: 'Choose the Due-from account (asset) in this company.' };
  if (!input.toDebitAccountId) return { error: 'Choose the destination (debit) account in the other company.' };
  if (!input.toDueToAccountId) return { error: 'Choose the Due-to account (liability) in the other company.' };
  if (!input.transferDate) return { error: 'Choose a transfer date.' };

  const amount = round2(Number(input.amount || 0));
  if (!(amount > 0)) return { error: 'Enter a transfer amount greater than zero.' };

  // v1: same-currency only. Refuse if the two companies don't share a base currency.
  const [fromCcy, toCcy] = await Promise.all([
    companyBaseCurrency(fromCompanyId),
    companyBaseCurrency(toCompanyId),
  ]);
  if (!fromCcy || !toCcy) return { error: 'Could not resolve the companies’ base currencies.' };
  if (fromCcy !== toCcy) {
    return {
      error: `Multi-currency transfers are not supported yet: ${fromCcy} → ${toCcy}. Both companies must share a base currency.`,
    };
  }
  const currency = fromCcy;
  const description = input.description?.trim() || null;
  const createdBy = ctx.user?.id ?? null;

  // ---- Leg A (source company): Dr Due-from-B, Cr Bank/source --------------------
  const { data: entryA, error: a1 } = await acc
    .from('journal_entries')
    .insert({
      company_id: fromCompanyId,
      entry_date: input.transferDate,
      currency_code: currency,
      description: 'Inter-company transfer',
      source: 'manual',
      status: 'draft',
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (a1 || !entryA) return { error: a1?.message ?? 'Could not create the source journal entry.' };

  const linesA = [
    {
      company_id: fromCompanyId,
      journal_entry_id: entryA.id,
      line_no: 1,
      account_id: input.fromDueFromAccountId,
      description: description ?? 'Due from related company',
      debit: amount,
      credit: 0,
      currency_code: currency,
      fx_rate: 1,
      base_debit: amount,
      base_credit: 0,
    },
    {
      company_id: fromCompanyId,
      journal_entry_id: entryA.id,
      line_no: 2,
      account_id: input.fromCreditAccountId,
      description: description ?? 'Inter-company transfer out',
      debit: 0,
      credit: amount,
      currency_code: currency,
      fx_rate: 1,
      base_debit: 0,
      base_credit: amount,
    },
  ];
  const { error: a2 } = await acc.from('journal_lines').insert(linesA);
  if (a2) return { error: a2.message };

  const { error: a3 } = await acc.rpc('post_journal_entry', { p_entry_id: entryA.id });
  if (a3) return { error: `Source company: ${a3.message}` };

  // ---- Leg B (destination company): Dr Bank/dest, Cr Due-to-A -------------------
  const { data: entryB, error: b1 } = await acc
    .from('journal_entries')
    .insert({
      company_id: toCompanyId,
      entry_date: input.transferDate,
      currency_code: currency,
      description: 'Inter-company transfer',
      source: 'manual',
      status: 'draft',
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (b1 || !entryB) {
    return {
      error: `Source leg posted, but the destination entry could not be created: ${b1?.message ?? 'unknown error'}. Reverse entry ${entryA.id} in the source company.`,
    };
  }

  const linesB = [
    {
      company_id: toCompanyId,
      journal_entry_id: entryB.id,
      line_no: 1,
      account_id: input.toDebitAccountId,
      description: description ?? 'Inter-company transfer in',
      debit: amount,
      credit: 0,
      currency_code: currency,
      fx_rate: 1,
      base_debit: amount,
      base_credit: 0,
    },
    {
      company_id: toCompanyId,
      journal_entry_id: entryB.id,
      line_no: 2,
      account_id: input.toDueToAccountId,
      description: description ?? 'Due to related company',
      debit: 0,
      credit: amount,
      currency_code: currency,
      fx_rate: 1,
      base_debit: 0,
      base_credit: amount,
    },
  ];
  const { error: b2 } = await acc.from('journal_lines').insert(linesB);
  if (b2) {
    return {
      error: `Source leg posted, but the destination lines failed: ${b2.message}. Reverse entry ${entryA.id} in the source company.`,
    };
  }

  const { error: b3 } = await acc.rpc('post_journal_entry', { p_entry_id: entryB.id });
  if (b3) {
    return {
      error: `Source leg posted, but the destination could not be posted: ${b3.message}. Both companies need an open period for ${input.transferDate}. Reverse entry ${entryA.id} in the source company, fix the period, and try again.`,
    };
  }

  // ---- Link the pair ------------------------------------------------------------
  const { error: link } = await supabase
    .schema('core')
    .from('intercompany_transfers')
    .insert({
      from_company_id: fromCompanyId,
      to_company_id: toCompanyId,
      from_entry_id: entryA.id,
      to_entry_id: entryB.id,
      amount,
      currency_code: currency,
      transfer_date: input.transferDate,
      description,
      created_by: createdBy,
    });
  if (link) {
    // Both legs posted; only the (cosmetic) link row failed. Report it but the
    // financial effect is complete — surface so the user can retry the link later.
    return {
      error: `Both journal entries posted, but the transfer link could not be saved: ${link.message}.`,
    };
  }

  revalidatePath('/accounting/transfers');
  return {};
}
