// Server-side data context for the Freight Forwarding module: the Supabase server
// client (user session + RLS), scoped helpers for the `freight` and `core` schemas,
// and the active company. Mirrors the cargo/accounting module context pattern.
import { createClient } from '@/lib/supabase/server';
import { getPlatformContext } from '@/core/session/context';

export async function freightDb() {
  const ctx = await getPlatformContext();
  const supabase = await createClient();
  return {
    supabase,
    // `freight` is cast loosely until `npm run db:types` regenerates
    // src/lib/database.types.ts to include the freight schema (after migrations run).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    freight: supabase.schema('freight' as any),
    core: supabase.schema('core'),
    companyId: ctx.activeCompanyId,
    ctx,
  };
}
