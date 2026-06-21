// Read-side data access for Cargo Assurance (server components). RLS scopes results
// to the active company. Client names are joined in JS (avoids cross-schema embeds).
import { cargoDb } from './context';

export type ReviewStatus = 'draft' | 'in_review' | 'reviewed' | 'approved' | 'published';
export type QuantityBasis = 'volume' | 'mass';

export interface Client {
  id: string;
  name: string;
  type: string | null;
  email: string | null;
}

export interface CargoType {
  id: string;
  key: string;
  name: string;
  category: string;
  default_density_kg_m3: number | null;
}

export interface ReviewRow {
  id: string;
  title: string;
  status: ReviewStatus;
  start_date: string;
  end_date: string;
  quantity_basis: QuantityBasis;
  client_id: string;
  clientName: string | null;
}

export interface ReviewDetail extends ReviewRow {
  notes: string | null;
  cargo_type: { name: string } | null;
}

export async function listClients(): Promise<Client[]> {
  const { core, companyId } = await cargoDb();
  if (!companyId) return [];
  const { data } = await core
    .from('clients')
    .select('id, name, type, email')
    .eq('company_id', companyId)
    .order('name');
  return (data as Client[] | null) ?? [];
}

export async function listCargoTypes(): Promise<CargoType[]> {
  const { cargo } = await cargoDb();
  const { data } = await cargo
    .from('cargo_types')
    .select('id, key, name, category, default_density_kg_m3')
    .eq('is_active', true)
    .order('category')
    .order('name');
  return (data as CargoType[] | null) ?? [];
}

async function clientNameMap(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { core } = await cargoDb();
  const { data } = await core.from('clients').select('id, name').in('id', ids);
  return new Map((data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
}

export async function listReviews(): Promise<ReviewRow[]> {
  const { cargo, companyId } = await cargoDb();
  if (!companyId) return [];
  const { data } = await cargo
    .from('assurance_reviews')
    .select('id, title, status, start_date, end_date, quantity_basis, client_id')
    .eq('company_id', companyId)
    .order('start_date', { ascending: false });
  const reviews = (data as any[] | null) ?? [];
  const names = await clientNameMap([...new Set(reviews.map((r) => r.client_id).filter(Boolean))]);
  return reviews.map((r) => ({ ...r, clientName: names.get(r.client_id) ?? null }));
}

export async function getReview(id: string): Promise<ReviewDetail | null> {
  const { cargo, companyId } = await cargoDb();
  if (!companyId) return null;
  const { data } = await cargo
    .from('assurance_reviews')
    .select('id, title, status, start_date, end_date, quantity_basis, notes, client_id, cargo_type:cargo_types(name)')
    .eq('company_id', companyId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const names = await clientNameMap([(data as any).client_id].filter(Boolean));
  return { ...(data as any), clientName: names.get((data as any).client_id) ?? null } as ReviewDetail;
}
