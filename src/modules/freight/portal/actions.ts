// Auth actions for the customer portal. Same Supabase email/password sign-in as
// staff, but redirects into /portal (never the internal app). Kept separate from
// core/session/auth-actions so the portal has its own entry/exit points.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signInPortal(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) {
    redirect('/portal/sign-in?error=' + encodeURIComponent('Email and password are required'));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect('/portal/sign-in?error=' + encodeURIComponent(error.message));
  }

  revalidatePath('/portal', 'layout');
  redirect('/portal');
}

export async function signOutPortal(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/portal', 'layout');
  redirect('/portal/sign-in');
}
