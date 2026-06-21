// Server-side data context for the Cargo Assurance module: the Supabase server
// client (user session + RLS), scoped helpers for the `cargo` and `core` schemas,
// and the active company. (Kept separate from the pure calc engine in index.ts.)
import { createClient } from '@/lib/supabase/server';
import { getPlatformContext } from '@/core/session/context';

export async function cargoDb() {
  const ctx = await getPlatformContext();
  const supabase = await createClient();
  return {
    supabase,
    cargo: supabase.schema('cargo'),
    core: supabase.schema('core'),
    companyId: ctx.activeCompanyId,
    ctx,
  };
}
