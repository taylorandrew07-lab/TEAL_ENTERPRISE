// Company Settings for the Accounting module: read the active company's profile and
// fiscal-year start, list selectable currencies, and persist edits. The fiscal-year
// start month drives period generation (see createFiscalYear in actions.ts), so the
// owner can set it per company rather than relying on a hard-coded default.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountingDb } from './context';

export interface CompanySettings {
  id: string;
  name: string;
  legal_name: string | null;
  base_currency_code: string;
  country_code: string;
  fiscal_year_start_month: number;
  timezone: string;
}

export interface CurrencyOption {
  code: string;
  name: string;
}

/** The active company's profile + fiscal-year start. Null when no company is active. */
export async function getCompanySettings(): Promise<CompanySettings | null> {
  const { supabase, companyId } = await accountingDb();
  if (!companyId) return null;
  const { data } = await supabase
    .schema('core')
    .from('companies')
    .select('id, name, legal_name, base_currency_code, country_code, fiscal_year_start_month, timezone')
    .eq('id', companyId)
    .maybeSingle();
  return (data as CompanySettings | null) ?? null;
}

/** Active currencies for the base-currency picker (shared reference data). */
export async function listCurrencies(): Promise<CurrencyOption[]> {
  const { acc } = await accountingDb();
  const { data } = await acc
    .from('currencies')
    .select('code, name')
    .eq('is_active', true)
    .order('code');
  return (data as CurrencyOption[] | null) ?? [];
}

function back(error?: string): never {
  redirect(
    error
      ? `/accounting/settings?error=${encodeURIComponent(error)}`
      : '/accounting/settings?ok=1',
  );
}

/**
 * Update the active company's profile. The page gates access with
 * requireModule('accounting', 'company.manage'); this action additionally validates
 * the fiscal-year start month (1..12) before writing. RLS scopes the update to the
 * active company.
 */
export async function updateCompanySettings(formData: FormData): Promise<void> {
  const { supabase, companyId } = await accountingDb();
  if (!companyId) back('No active company');

  const name = String(formData.get('name') ?? '').trim();
  const legalRaw = String(formData.get('legal_name') ?? '').trim();
  const base_currency_code = String(formData.get('base_currency_code') ?? '').trim().toUpperCase();
  const country_code = String(formData.get('country_code') ?? '').trim().toUpperCase();
  const fiscalRaw = String(formData.get('fiscal_year_start_month') ?? '');
  const fiscal_year_start_month = parseInt(fiscalRaw, 10);

  if (!name) back('Company name is required');
  if (!base_currency_code) back('Base currency is required');
  if (country_code.length !== 2) back('Country code must be a 2-letter ISO code');
  if (
    !Number.isInteger(fiscal_year_start_month) ||
    fiscal_year_start_month < 1 ||
    fiscal_year_start_month > 12
  ) {
    back('Fiscal-year start month must be between 1 and 12');
  }

  const { error } = await supabase
    .schema('core')
    .from('companies')
    .update({
      name,
      legal_name: legalRaw || null,
      base_currency_code,
      country_code,
      fiscal_year_start_month,
    })
    .eq('id', companyId);

  if (error) back(error.message);
  revalidatePath('/accounting/settings');
  back();
}
