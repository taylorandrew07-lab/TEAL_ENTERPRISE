// =============================================================================
// TEAL Enterprise — active-company selection
// -----------------------------------------------------------------------------
// The active company is stored in a cookie and validated against the user's
// memberships server-side. Switching companies re-scopes the whole platform.
// =============================================================================
'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

// Not exported: a 'use server' module may only export async functions.
const ACTIVE_COMPANY_COOKIE = 'teal_active_company';

/** Read the active-company id from the request cookies (if any). */
export async function readActiveCompanyId(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_COMPANY_COOKIE)?.value ?? null;
}

/**
 * Server action: set the active company. Bound to the company switcher form.
 * Validation that the user is actually a member of this company is enforced by
 * RLS on every subsequent query and re-checked when the context is resolved.
 */
export async function setActiveCompany(formData: FormData): Promise<void> {
  const companyId = String(formData.get('companyId') ?? '');
  if (!companyId) return;
  const store = await cookies();
  store.set(ACTIVE_COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/', 'layout');
}
