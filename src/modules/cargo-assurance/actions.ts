// Write-side server actions for Cargo Assurance. Mutations go through RLS.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cargoDb } from './context';

function back(path: string, error?: string): never {
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

export async function addClient(formData: FormData): Promise<void> {
  const { core, companyId } = await cargoDb();
  if (!companyId) back('/cargo-assurance/clients', 'No active company');
  const name = String(formData.get('name') ?? '').trim();
  const type = String(formData.get('type') ?? 'customer');
  const email = String(formData.get('email') ?? '').trim() || null;
  if (!name) back('/cargo-assurance/clients', 'Client name is required');

  const { error } = await core.from('clients').insert({ company_id: companyId, name, type, email });
  if (error) back('/cargo-assurance/clients', error.message);
  revalidatePath('/cargo-assurance/clients');
  back('/cargo-assurance/clients');
}

export async function createReview(formData: FormData): Promise<void> {
  const { cargo, companyId, ctx } = await cargoDb();
  if (!companyId) back('/cargo-assurance/reviews/new', 'No active company');
  const title = String(formData.get('title') ?? '').trim();
  const client_id = String(formData.get('client_id') ?? '');
  const start_date = String(formData.get('start_date') ?? '');
  const end_date = String(formData.get('end_date') ?? '');
  const quantity_basis = String(formData.get('quantity_basis') ?? 'volume');
  const default_cargo_type_id = String(formData.get('default_cargo_type_id') ?? '') || null;

  if (!title || !client_id || !start_date || !end_date) {
    back('/cargo-assurance/reviews/new', 'Title, client and both dates are required');
  }
  if (end_date < start_date) back('/cargo-assurance/reviews/new', 'End date must be on or after the start date');

  const { data, error } = await cargo
    .from('assurance_reviews')
    .insert({
      company_id: companyId,
      client_id,
      title,
      start_date,
      end_date,
      quantity_basis,
      default_cargo_type_id,
      status: 'draft',
      created_by: ctx.user?.id ?? null,
    })
    .select('id')
    .single();
  if (error || !data) back('/cargo-assurance/reviews/new', error?.message ?? 'Could not create the review');

  revalidatePath('/cargo-assurance/reviews');
  redirect(`/cargo-assurance/reviews/${data.id}`);
}

export async function setReviewStatus(formData: FormData): Promise<void> {
  const { cargo, companyId } = await cargoDb();
  if (!companyId) back('/cargo-assurance/reviews', 'No active company');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !['draft', 'in_review', 'reviewed', 'approved', 'published'].includes(status)) {
    back('/cargo-assurance/reviews', 'Invalid request');
  }
  const { error } = await cargo.from('assurance_reviews').update({ status }).eq('id', id).eq('company_id', companyId);
  if (error) back(`/cargo-assurance/reviews/${id}`, error.message);
  revalidatePath(`/cargo-assurance/reviews/${id}`);
  back(`/cargo-assurance/reviews/${id}`);
}
