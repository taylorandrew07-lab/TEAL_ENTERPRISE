// Server-side accounting data context: the Supabase server client (with the user's
// session + RLS), scoped helpers for the `accounting` schema, and the active company.
import { createClient } from '@/lib/supabase/server';
import { getPlatformContext } from '@/core/session/context';

export async function accountingDb() {
  const ctx = await getPlatformContext();
  const supabase = await createClient();
  return {
    supabase,
    acc: supabase.schema('accounting'),
    companyId: ctx.activeCompanyId,
    ctx,
  };
}

// --- shared reference-data reads (consolidated; previously copy-pasted per file) ---

/** The base/reporting currency for ANY company, or null if unresolved. */
export async function companyBaseCurrencyOf(companyId: string): Promise<string | null> {
  const { supabase } = await accountingDb();
  const { data } = await supabase
    .schema('core')
    .from('companies')
    .select('base_currency_code')
    .eq('id', companyId)
    .maybeSingle();
  return (data as { base_currency_code: string } | null)?.base_currency_code ?? null;
}

/** The active company's base/reporting currency; defaults to 'TTD' when unresolved. */
export async function activeBaseCurrency(): Promise<string> {
  const { companyId } = await accountingDb();
  if (!companyId) return 'TTD';
  return (await companyBaseCurrencyOf(companyId)) ?? 'TTD';
}

/** Active currency codes — reference data for FX + banking dropdowns. */
export async function listCurrencyCodes(): Promise<string[]> {
  const { acc } = await accountingDb();
  const { data } = await acc.from('currencies').select('code').eq('is_active', true).order('code');
  return ((data as { code: string }[] | null) ?? []).map((c) => c.code);
}
