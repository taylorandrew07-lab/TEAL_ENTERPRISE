// Server actions for the signed-in user's own account. Self-service only: a user may
// edit their own display name (core.users RLS allows id = auth.uid()). redirect() is
// called outside any try/catch per Next.js rules.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function updateDisplayName(formData: FormData): Promise<void> {
  const fullName = String(formData.get('fullName') ?? '').trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  if (!fullName) {
    redirect('/account?error=' + encodeURIComponent('Display name cannot be empty'));
  }

  const { error } = await supabase
    .schema('core')
    .from('users')
    .update({ full_name: fullName })
    .eq('id', user.id);

  if (error) {
    redirect('/account?error=' + encodeURIComponent(error.message));
  }

  revalidatePath('/', 'layout');
  redirect('/account?saved=1');
}
