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
