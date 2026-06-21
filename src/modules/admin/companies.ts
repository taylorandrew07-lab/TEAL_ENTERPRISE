// =============================================================================
// TEAL Enterprise — Administration: Companies
// -----------------------------------------------------------------------------
// The data + action layer behind Administration → Companies: list the companies
// the user can see, list selectable base currencies, and create a new company
// (with the creator as company_admin, the standard modules enabled, and the new
// company set active). All reads run under the user's session + RLS.
//
// RLS NOTE (flagged to the owner): core.companies INSERT is gated by
// core.is_super_admin() (see 0003_rls_and_helpers.sql, companies_ins). So today
// only super admins can create a company through this action. Letting a regular
// user self-provision a company would need a companies_ins policy change AND a
// way to seed their first membership without tripping company_memberships' own
// users.manage insert check. Documented here; not changed by this feature.
// =============================================================================
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPlatformContext } from '@/core/session/context';
import { setActiveCompany } from '@/core/session/active-company';

export interface AdminCompany {
  id: string;
  name: string;
  base_currency_code: string;
  country_code: string;
  fiscal_year_start_month: number;
}

export interface CurrencyOption {
  code: string;
  name: string;
}

/**
 * Companies the current user may see. Super admins see all; everyone else sees
 * the companies behind their active memberships. RLS (companies_sel) already
 * scopes this, but we filter explicitly so the listing is honest regardless.
 */
export async function listCompanies(): Promise<AdminCompany[]> {
  const ctx = await getPlatformContext();
  const supabase = await createClient();
  const core = supabase.schema('core');

  const query = core
    .from('companies')
    .select('id, name, base_currency_code, country_code, fiscal_year_start_month')
    .order('name');

  // Regular users: restrict to the companies resolved into their context.
  if (!ctx.isSuperAdmin) {
    const ids = ctx.companies.map((c) => c.id);
    if (ids.length === 0) return [];
    query.in('id', ids);
  }

  const { data } = await query;
  return (data as AdminCompany[] | null) ?? [];
}

/** Active currencies for the base-currency picker (shared reference data). */
export async function listCurrencies(): Promise<CurrencyOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .schema('accounting')
    .from('currencies')
    .select('code, name')
    .eq('is_active', true)
    .order('code');
  return (data as CurrencyOption[] | null) ?? [];
}

function fail(error: string): never {
  redirect(`/admin/companies?error=${encodeURIComponent(error)}`);
}

/**
 * Create a company, make the creator its company_admin, enable the standard
 * modules, then set the new company active and land on the launcher.
 *
 * The page already gates with requireAuth + super-admin/company.manage; this
 * action re-validates inputs. Under the current RLS the companies INSERT will
 * only succeed for a super admin (see the RLS NOTE at the top of this file).
 */
export async function createCompany(formData: FormData): Promise<void> {
  const ctx = await getPlatformContext();
  if (!ctx.user) fail('You must be signed in to create a company.');

  const name = String(formData.get('name') ?? '').trim();
  const base_currency_code = String(formData.get('base_currency_code') ?? '')
    .trim()
    .toUpperCase();
  const country_code =
    String(formData.get('country_code') ?? '').trim().toUpperCase() || 'TT';
  const fiscal_year_start_month = parseInt(
    String(formData.get('fiscal_year_start_month') ?? '1'),
    10,
  );

  if (!name) fail('Company name is required.');
  if (!base_currency_code) fail('Base currency is required.');
  if (country_code.length !== 2) fail('Country code must be a 2-letter ISO code.');
  if (
    !Number.isInteger(fiscal_year_start_month) ||
    fiscal_year_start_month < 1 ||
    fiscal_year_start_month > 12
  ) {
    fail('Fiscal-year start month must be between 1 and 12.');
  }

  const supabase = await createClient();
  const core = supabase.schema('core');

  // 1) The company. legal_name mirrors name on creation; both editable later in
  //    Accounting → Company Settings.
  const { data: company, error: companyErr } = await core
    .from('companies')
    .insert({
      name,
      legal_name: name,
      base_currency_code,
      fiscal_year_start_month,
      country_code,
      timezone: 'America/Port_of_Spain',
    })
    .select('id')
    .single();

  if (companyErr || !company) {
    fail(
      companyErr?.message ??
        'Could not create the company. Company creation currently requires a super-admin account.',
    );
  }

  const companyId = (company as { id: string }).id;

  // 2) Make the creator a company_admin (the system role: company_id null,
  //    is_system true). Without this the creator could not see their own company.
  const { data: role, error: roleErr } = await core
    .from('roles')
    .select('id')
    .eq('key', 'company_admin')
    .eq('is_system', true)
    .is('company_id', null)
    .maybeSingle();

  if (roleErr || !role) {
    fail('Company created, but the company_admin role is missing. Contact an administrator.');
  }

  const { error: membershipErr } = await core.from('company_memberships').insert({
    user_id: ctx.user.id,
    company_id: companyId,
    role_id: (role as { id: string }).id,
    status: 'active',
  });

  if (membershipErr) {
    fail(`Company created, but assigning you as its admin failed: ${membershipErr.message}`);
  }

  // 3) Enable the standard modules for the new company.
  const { data: modules } = await core
    .from('modules')
    .select('id, key')
    .in('key', ['accounting', 'cargo_assurance']);

  if (modules && modules.length > 0) {
    await core.from('company_modules').insert(
      (modules as { id: string; key: string }[]).map((m) => ({
        company_id: companyId,
        module_id: m.id,
        enabled: true,
      })),
    );
  }

  // 4) Set the new company active for the session, then land on the launcher.
  const activeForm = new FormData();
  activeForm.set('companyId', companyId);
  await setActiveCompany(activeForm);

  revalidatePath('/admin/companies');
  redirect('/');
}
