// Service-role Supabase client. SERVER-ONLY. Bypasses RLS — use only in trusted
// server contexts (e.g. controlled administrative tasks, webhooks). Never import
// this into client components or expose the key to the browser.
// `server-only` makes any client-component import a build-time error.
import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — admin client unavailable.');
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
