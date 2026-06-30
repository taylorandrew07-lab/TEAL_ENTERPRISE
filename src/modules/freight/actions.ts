// Write-side server actions for Freight Forwarding. Mutations go through RLS, so a
// missing permission is rejected at the database regardless of UI. These same
// actions are the surface AI tool-calls will reuse later (see _FREIGHT-SPEC §7).
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { freightDb } from './context';
import { computeFreeTime } from './freetime';
import { getTrackingProvider } from './tracking';
import { STAGE_ORDER, type ShipmentStage } from './lifecycle';

function back(path: string, error?: string): never {
  // Only internal absolute paths — block external/protocol-relative open redirects.
  const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/freight';
  redirect(error ? `${safe}?error=${encodeURIComponent(error)}` : safe);
}

// Advance a shipment forward to `target` only if it's currently behind it (never
// move backwards). Keeps the job's stage in step with workflow actions (F-11).
async function advanceShipmentTo(freight: any, companyId: string, shipmentId: string | null, target: ShipmentStage): Promise<void> {
  if (!shipmentId) return;
  const { data: sh } = await freight.from('shipments').select('stage').eq('id', shipmentId).eq('company_id', companyId).maybeSingle();
  const cur = (sh as any)?.stage as ShipmentStage | undefined;
  if (cur && STAGE_ORDER.indexOf(cur) < STAGE_ORDER.indexOf(target)) {
    await freight.from('shipments').update({ stage: target }).eq('id', shipmentId).eq('company_id', companyId);
  }
}

// ----------------------------------------------------------------------------- contacts
export async function createContact(formData: FormData): Promise<void> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) back('/freight/contacts/new', 'No active company');

  const name = String(formData.get('name') ?? '').trim();
  if (!name) back('/freight/contacts/new', 'Contact name is required');
  const kind = String(formData.get('kind') ?? 'organization');
  const roles = formData.getAll('roles').map(String).filter(Boolean);
  const country_code = String(formData.get('country_code') ?? '').trim().toUpperCase() || null;
  const email = String(formData.get('email') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const payment_terms = String(formData.get('payment_terms') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const { data, error } = await freight
    .from('contacts')
    .insert({
      company_id: companyId,
      name,
      kind,
      roles,
      country_code,
      emails: email ? [{ label: 'main', address: email }] : [],
      phones: phone ? [{ label: 'main', number: phone }] : [],
      payment_terms,
      notes,
      created_by: ctx.user?.id ?? null,
    })
    .select('id')
    .single();
  if (error || !data) back('/freight/contacts/new', error?.message ?? 'Could not create contact');

  revalidatePath('/freight/contacts');
  redirect(`/freight/contacts/${data.id}`);
}

// ----------------------------------------------------------------------------- shipments
export async function createShipment(formData: FormData): Promise<void> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) back('/freight/shipments/new', 'No active company');

  const customer_contact_id = String(formData.get('customer_contact_id') ?? '') || null;
  const mode = String(formData.get('mode') ?? '') || null;
  const direction = String(formData.get('direction') ?? '') || null;
  const incoterm = String(formData.get('incoterm') ?? '').trim() || null;
  const origin_name = String(formData.get('origin_name') ?? '').trim() || null;
  const destination_name = String(formData.get('destination_name') ?? '').trim() || null;
  const commodity = String(formData.get('commodity') ?? '').trim() || null;
  const currency_code = String(formData.get('currency_code') ?? '').trim().toUpperCase() || null;

  const { data, error } = await freight
    .from('shipments')
    .insert({
      company_id: companyId,
      stage: 'lead',
      status: 'active',
      customer_contact_id,
      mode,
      direction,
      incoterm,
      origin_name,
      destination_name,
      commodity,
      currency_code,
      owner_user_id: ctx.user?.id ?? null,
      created_by: ctx.user?.id ?? null,
    })
    .select('id')
    .single();
  if (error || !data) back('/freight/shipments/new', error?.message ?? 'Could not create shipment');

  // Mirror primary customer into shipment_parties (best-effort; non-fatal).
  if (customer_contact_id) {
    await freight.from('shipment_parties').insert({
      company_id: companyId, shipment_id: data.id, contact_id: customer_contact_id, role: 'customer',
    });
  }

  revalidatePath('/freight/shipments');
  redirect(`/freight/shipments/${data.id}`);
}

export async function setShipmentStage(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const id = String(formData.get('id') ?? '');
  const stage = String(formData.get('stage') ?? '');
  if (!id || !stage) back('/freight/shipments', 'Invalid request');

  const { error } = await freight.from('shipments').update({ stage }).eq('id', id).eq('company_id', companyId);
  if (error) back(`/freight/shipments/${id}`, error.message);
  revalidatePath(`/freight/shipments/${id}`);
  back(`/freight/shipments/${id}`);
}

export async function setShipmentStatus(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !['active', 'on_hold', 'cancelled'].includes(status)) back('/freight/shipments', 'Invalid request');

  const { error } = await freight.from('shipments').update({ status }).eq('id', id).eq('company_id', companyId);
  if (error) back(`/freight/shipments/${id}`, error.message);
  revalidatePath(`/freight/shipments/${id}`);
  back(`/freight/shipments/${id}`);
}

export async function addShipmentParty(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const shipment_id = String(formData.get('shipment_id') ?? '');
  const contact_id = String(formData.get('contact_id') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!shipment_id || !contact_id || !role) back(`/freight/shipments/${shipment_id}`, 'Choose a contact and role');

  const { error } = await freight.from('shipment_parties').insert({
    company_id: companyId, shipment_id, contact_id, role,
  });
  if (error) back(`/freight/shipments/${shipment_id}`, error.message);
  revalidatePath(`/freight/shipments/${shipment_id}`);
  back(`/freight/shipments/${shipment_id}`);
}

// ----------------------------------------------------------------------------- tasks
export async function createTask(formData: FormData): Promise<void> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) back('/freight/tasks', 'No active company');
  const shipment_id = String(formData.get('shipment_id') ?? '') || null;
  const title = String(formData.get('title') ?? '').trim();
  const priority = String(formData.get('priority') ?? 'normal');
  const due_at = String(formData.get('due_at') ?? '') || null;
  if (!title) back(shipment_id ? `/freight/shipments/${shipment_id}` : '/freight/tasks', 'Task title is required');

  const { error } = await freight.from('tasks').insert({
    company_id: companyId, shipment_id, title, priority, due_at, created_by: ctx.user?.id ?? null,
  });
  const dest = shipment_id ? `/freight/shipments/${shipment_id}` : '/freight/tasks';
  if (error) back(dest, error.message);
  revalidatePath(dest);
  back(dest);
}

export async function setTaskStatus(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/tasks', 'No active company');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  const rt = String(formData.get('return_to') ?? '/freight/tasks');
  const dest = rt.startsWith('/freight/') ? rt : '/freight/tasks'; // whitelist internal freight paths only
  if (!id || !['open', 'doing', 'blocked', 'done', 'cancelled'].includes(status)) back(dest, 'Invalid request');

  const patch: Record<string, unknown> = { status };
  if (status === 'done') patch.completed_at = new Date().toISOString();
  const { error } = await freight.from('tasks').update(patch).eq('id', id).eq('company_id', companyId);
  if (error) back(dest, error.message);
  revalidatePath(dest);
  back(dest);
}

// ----------------------------------------------------------------------------- communications
export async function addCommunication(formData: FormData): Promise<void> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const shipment_id = String(formData.get('shipment_id') ?? '');
  const channel = String(formData.get('channel') ?? 'note');
  const direction = String(formData.get('direction') ?? 'internal');
  const subject = String(formData.get('subject') ?? '').trim() || null;
  const body = String(formData.get('body') ?? '').trim();
  if (!shipment_id || !body) back(`/freight/shipments/${shipment_id}`, 'Write something to log');

  const { error } = await freight.from('communications').insert({
    company_id: companyId, shipment_id, channel, direction, subject, body, author_user_id: ctx.user?.id ?? null,
  });
  if (error) back(`/freight/shipments/${shipment_id}`, error.message);
  revalidatePath(`/freight/shipments/${shipment_id}`);
  back(`/freight/shipments/${shipment_id}`);
}

// ----------------------------------------------------------------------------- charges
export async function addCharge(formData: FormData): Promise<void> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const shipment_id = String(formData.get('shipment_id') ?? '');
  const kind = String(formData.get('kind') ?? 'charge');
  const description = String(formData.get('description') ?? '').trim();
  const charge_code = String(formData.get('charge_code') ?? '').trim() || null;
  const amount = Number(formData.get('amount') ?? 0);
  const fxRaw = formData.get('fx_rate');
  const fx_rate = fxRaw ? Number(fxRaw) : 1;
  const currency_code = String(formData.get('currency_code') ?? '').trim().toUpperCase() || null;
  const contact_id = String(formData.get('contact_id') ?? '') || null;
  if (!shipment_id || !description) back(`/freight/shipments/${shipment_id}`, 'Description is required');
  if (!['cost', 'charge'].includes(kind)) back(`/freight/shipments/${shipment_id}`, 'Invalid charge kind');

  const amt = Number.isFinite(amount) ? amount : 0;
  const rate = Number.isFinite(fx_rate) && fx_rate > 0 ? fx_rate : 1; // rate to company base currency
  const { error } = await freight.from('charges').insert({
    company_id: companyId, shipment_id, kind, description, charge_code,
    amount: amt, fx_rate: rate, base_amount: amt * rate,
    currency_code, contact_id, created_by: ctx.user?.id ?? null,
  });
  if (error) back(`/freight/shipments/${shipment_id}`, error.message);

  // Refresh cached financial rollups on the shipment (sum charges/costs).
  await refreshShipmentFinancials(shipment_id, companyId, freight);

  revalidatePath(`/freight/shipments/${shipment_id}`);
  back(`/freight/shipments/${shipment_id}`);
}

async function refreshShipmentFinancials(shipmentId: string, companyId: string, freight: any): Promise<void> {
  const { data } = await freight
    .from('charges').select('kind, base_amount').eq('company_id', companyId).eq('shipment_id', shipmentId);
  const rows = (data as { kind: string; base_amount: number }[] | null) ?? [];
  const total_charge = rows.filter((r) => r.kind === 'charge').reduce((s, r) => s + Number(r.base_amount || 0), 0);
  const total_cost = rows.filter((r) => r.kind === 'cost').reduce((s, r) => s + Number(r.base_amount || 0), 0);
  await freight.from('shipments')
    .update({ total_charge, total_cost, expected_profit: total_charge - total_cost })
    .eq('id', shipmentId).eq('company_id', companyId);
}

// ============================================================================= QUOTES
// RFQ pipeline: request → recipients → supplier quotes → customer quotation. These
// are the actions the future AI quote-loop will call (see _FREIGHT-SPEC §7).

export async function createRfq(formData: FormData): Promise<void> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) back('/freight/quotes', 'No active company');
  const shipment_id = String(formData.get('shipment_id') ?? '') || null;
  const due_by = String(formData.get('due_by') ?? '') || null;

  const { data, error } = await freight
    .from('quote_requests')
    .insert({ company_id: companyId, shipment_id, due_by, status: 'draft', requested_by: ctx.user?.id ?? null })
    .select('id').single();
  if (error || !data) back('/freight/quotes/rfq/new', error?.message ?? 'Could not create RFQ');
  await advanceShipmentTo(freight, companyId, shipment_id, 'rfq');
  revalidatePath('/freight/quotes');
  redirect(`/freight/quotes/rfq/${data.id}`);
}

export async function addRfqRecipient(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/quotes', 'No active company');
  const rfq_id = String(formData.get('rfq_id') ?? '');
  const contact_id = String(formData.get('contact_id') ?? '');
  if (!rfq_id || !contact_id) back(`/freight/quotes/rfq/${rfq_id}`, 'Choose a contact');
  const { error } = await freight.from('quote_request_recipients').insert({
    company_id: companyId, quote_request_id: rfq_id, contact_id, status: 'pending',
  });
  if (error) back(`/freight/quotes/rfq/${rfq_id}`, error.message);
  revalidatePath(`/freight/quotes/rfq/${rfq_id}`);
  back(`/freight/quotes/rfq/${rfq_id}`);
}

export async function markRecipientSent(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/quotes', 'No active company');
  const rfq_id = String(formData.get('rfq_id') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!id) back(`/freight/quotes/rfq/${rfq_id}`, 'Invalid request');
  await freight.from('quote_request_recipients')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', id).eq('company_id', companyId);
  // move the RFQ itself to 'sent' if still draft
  await freight.from('quote_requests').update({ status: 'sent' })
    .eq('id', rfq_id).eq('company_id', companyId).eq('status', 'draft');
  revalidatePath(`/freight/quotes/rfq/${rfq_id}`);
  back(`/freight/quotes/rfq/${rfq_id}`);
}

export async function recordSupplierQuote(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/quotes', 'No active company');
  const rfq_id = String(formData.get('rfq_id') ?? '');
  const shipment_id = String(formData.get('shipment_id') ?? '') || null;
  const contact_id = String(formData.get('contact_id') ?? '');
  const total_amount = Number(formData.get('total_amount') ?? 0);
  const transit = formData.get('transit_time_days');
  const transit_time_days = transit ? Number(transit) : null;
  const currency_code = String(formData.get('currency_code') ?? '').trim().toUpperCase() || null;
  const valid_until = String(formData.get('valid_until') ?? '') || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (!contact_id) back(`/freight/quotes/rfq/${rfq_id}`, 'Choose the supplier');

  const { error } = await freight.from('supplier_quotes').insert({
    company_id: companyId, quote_request_id: rfq_id || null, shipment_id, contact_id,
    status: 'received', currency_code, total_amount: Number.isFinite(total_amount) ? total_amount : null,
    transit_time_days, valid_until, notes,
  });
  if (error) back(`/freight/quotes/rfq/${rfq_id}`, error.message);
  // mark the recipient (if any) as responded
  if (rfq_id) {
    await freight.from('quote_request_recipients')
      .update({ status: 'responded', responded_at: new Date().toISOString() })
      .eq('company_id', companyId).eq('quote_request_id', rfq_id).eq('contact_id', contact_id);
  }
  revalidatePath(`/freight/quotes/rfq/${rfq_id}`);
  back(`/freight/quotes/rfq/${rfq_id}`);
}

export async function selectSupplierQuote(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/quotes', 'No active company');
  const rfq_id = String(formData.get('rfq_id') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!id) back(`/freight/quotes/rfq/${rfq_id}`, 'Invalid request');
  // de-select siblings, select this one
  if (rfq_id) {
    await freight.from('supplier_quotes').update({ status: 'received' })
      .eq('company_id', companyId).eq('quote_request_id', rfq_id).eq('status', 'selected');
  }
  await freight.from('supplier_quotes').update({ status: 'selected' }).eq('id', id).eq('company_id', companyId);
  revalidatePath(`/freight/quotes/rfq/${rfq_id}`);
  back(`/freight/quotes/rfq/${rfq_id}`);
}

export async function createCustomerQuote(formData: FormData): Promise<void> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) back('/freight/quotes', 'No active company');
  const shipment_id = String(formData.get('shipment_id') ?? '');
  const supplier_quote_id = String(formData.get('supplier_quote_id') ?? '') || null;
  const currency_code = String(formData.get('currency_code') ?? '').trim().toUpperCase() || null;
  const valid_until = String(formData.get('valid_until') ?? '') || null;
  if (!shipment_id) back('/freight/quotes/customer/new', 'Choose a shipment');

  // next revision for this shipment
  const { data: existing } = await freight.from('customer_quotes')
    .select('revision').eq('company_id', companyId).eq('shipment_id', shipment_id)
    .order('revision', { ascending: false }).limit(1);
  const revision = ((existing as { revision: number }[] | null)?.[0]?.revision ?? 0) + 1;

  // cost basis from a selected supplier quote (optional)
  let total_cost = 0;
  let ccy = currency_code;
  if (supplier_quote_id) {
    const { data: sq } = await freight.from('supplier_quotes')
      .select('total_amount, currency_code').eq('id', supplier_quote_id).eq('company_id', companyId).maybeSingle();
    if (sq) { total_cost = Number((sq as any).total_amount ?? 0); ccy = ccy ?? (sq as any).currency_code; }
  }

  const { data, error } = await freight.from('customer_quotes').insert({
    company_id: companyId, shipment_id, revision, status: 'draft',
    currency_code: ccy, total_cost, total_amount: 0, margin: -total_cost,
    valid_until, created_by: ctx.user?.id ?? null,
  }).select('id').single();
  if (error || !data) back('/freight/quotes/customer/new', error?.message ?? 'Could not create quotation');
  await advanceShipmentTo(freight, companyId, shipment_id, 'customer_quote');
  revalidatePath('/freight/quotes');
  redirect(`/freight/quotes/customer/${data.id}`);
}

export async function addQuoteLine(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/quotes', 'No active company');
  const customer_quote_id = String(formData.get('customer_quote_id') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const charge_code = String(formData.get('charge_code') ?? '').trim() || null;
  const quantity = Number(formData.get('quantity') ?? 1) || 1;
  const unit = String(formData.get('unit') ?? '').trim() || null;
  const rate = Number(formData.get('rate') ?? 0) || 0;
  const currency_code = String(formData.get('currency_code') ?? '').trim().toUpperCase() || null;
  if (!customer_quote_id || !description) back(`/freight/quotes/customer/${customer_quote_id}`, 'Description is required');

  const { error } = await freight.from('quote_lines').insert({
    company_id: companyId, customer_quote_id, description, charge_code, quantity, unit, rate,
    currency_code, amount: quantity * rate,
  });
  if (error) back(`/freight/quotes/customer/${customer_quote_id}`, error.message);
  await recomputeCustomerQuoteTotals(customer_quote_id, companyId, freight);
  revalidatePath(`/freight/quotes/customer/${customer_quote_id}`);
  back(`/freight/quotes/customer/${customer_quote_id}`);
}

export async function setCustomerQuoteStatus(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/quotes', 'No active company');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !['draft', 'sent', 'approved', 'rejected', 'expired', 'superseded'].includes(status)) {
    back(`/freight/quotes/customer/${id}`, 'Invalid status');
  }
  const patch: Record<string, unknown> = { status };
  if (status === 'sent') patch.sent_at = new Date().toISOString();
  if (status === 'approved' || status === 'rejected') patch.decided_at = new Date().toISOString();
  const { error } = await freight.from('customer_quotes').update(patch).eq('id', id).eq('company_id', companyId);
  if (error) back(`/freight/quotes/customer/${id}`, error.message);

  // Approval auto-advances the job into booking so it flows on into tracking — one
  // continuous workflow (the stage trigger then seeds booking tasks/milestones).
  if (status === 'approved') {
    const { data: cq } = await freight.from('customer_quotes').select('shipment_id').eq('id', id).eq('company_id', companyId).maybeSingle();
    const shipmentId = (cq as any)?.shipment_id;
    if (shipmentId) {
      const { data: sh } = await freight.from('shipments').select('stage').eq('id', shipmentId).eq('company_id', companyId).maybeSingle();
      const cur = (sh as any)?.stage;
      if (cur && STAGE_ORDER.indexOf(cur) < STAGE_ORDER.indexOf('booking_confirmed')) {
        await freight.from('shipments').update({ stage: 'booking_confirmed' }).eq('id', shipmentId).eq('company_id', companyId);
      }
    }
  }

  revalidatePath(`/freight/quotes/customer/${id}`);
  back(`/freight/quotes/customer/${id}`);
}

// Copy an approved quotation's lines onto the shipment as customer charges, and the
// quote's cost basis as a supplier cost — so the job's financial summary reflects it.
export async function pushQuoteToCharges(formData: FormData): Promise<void> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) back('/freight/quotes', 'No active company');
  const id = String(formData.get('id') ?? '');
  if (!id) back('/freight/quotes', 'Invalid request');

  const { data: cq } = await freight.from('customer_quotes')
    .select('id, shipment_id, currency_code, total_cost').eq('id', id).eq('company_id', companyId).maybeSingle();
  if (!cq) back('/freight/quotes', 'Quotation not found');
  const quote = cq as any;

  const { data: lines } = await freight.from('quote_lines')
    .select('description, charge_code, amount, currency_code, id').eq('company_id', companyId).eq('customer_quote_id', id);

  // Idempotency (F-09): if any of this quote's lines are already on the shipment as
  // charges, it was posted before — don't double-count revenue/cost.
  const lineIds = ((lines as any[] | null) ?? []).map((l) => l.id);
  if (lineIds.length) {
    const { data: already } = await freight.from('charges').select('id').eq('company_id', companyId).in('quote_line_id', lineIds).limit(1);
    if ((already as any[] | null)?.length) back(`/freight/quotes/customer/${id}`, 'This quotation has already been posted to the shipment charges');
  }

  const chargeRows = ((lines as any[] | null) ?? []).map((l) => ({
    company_id: companyId, shipment_id: quote.shipment_id, kind: 'charge',
    description: l.description, charge_code: l.charge_code,
    amount: Number(l.amount || 0), base_amount: Number(l.amount || 0),
    currency_code: l.currency_code ?? quote.currency_code, quote_line_id: l.id,
    created_by: ctx.user?.id ?? null,
  }));
  if (chargeRows.length) await freight.from('charges').insert(chargeRows);

  if (Number(quote.total_cost || 0) > 0) {
    await freight.from('charges').insert({
      company_id: companyId, shipment_id: quote.shipment_id, kind: 'cost',
      description: `Supplier cost (from ${id.slice(0, 8)})`, amount: Number(quote.total_cost),
      base_amount: Number(quote.total_cost), currency_code: quote.currency_code, created_by: ctx.user?.id ?? null,
    });
  }

  await refreshShipmentFinancials(quote.shipment_id, companyId, freight);
  revalidatePath(`/freight/shipments/${quote.shipment_id}`);
  back(`/freight/shipments/${quote.shipment_id}`);
}

async function recomputeCustomerQuoteTotals(quoteId: string, companyId: string, freight: any): Promise<void> {
  const { data } = await freight.from('quote_lines').select('amount').eq('company_id', companyId).eq('customer_quote_id', quoteId);
  const total_amount = ((data as { amount: number }[] | null) ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const { data: cq } = await freight.from('customer_quotes').select('total_cost').eq('id', quoteId).eq('company_id', companyId).maybeSingle();
  const total_cost = Number((cq as any)?.total_cost ?? 0);
  await freight.from('customer_quotes').update({ total_amount, margin: total_amount - total_cost }).eq('id', quoteId).eq('company_id', companyId);
}

// ============================================================================= CONTAINERS & TRACKING
export async function addContainer(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const shipment_id = String(formData.get('shipment_id') ?? '');
  const container_no = String(formData.get('container_no') ?? '').trim().toUpperCase() || null;
  const iso_type = String(formData.get('iso_type') ?? '').trim() || null;
  const size = String(formData.get('size') ?? '').trim() || null;
  const ownership = String(formData.get('ownership') ?? 'coc');
  const freeRaw = formData.get('free_time_days');
  const free_time_days = freeRaw ? Number(freeRaw) : null;
  if (!shipment_id) back('/freight/shipments', 'Missing shipment');

  const { error } = await freight.from('containers').insert({
    company_id: companyId, shipment_id, container_no, iso_type, size, ownership,
    free_time_days: Number.isFinite(free_time_days as number) ? free_time_days : null, status: 'planned',
  });
  if (error) back(`/freight/shipments/${shipment_id}`, error.message);
  revalidatePath(`/freight/shipments/${shipment_id}`);
  back(`/freight/shipments/${shipment_id}`);
}

export async function updateContainer(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const id = String(formData.get('id') ?? '');
  const shipment_id = String(formData.get('shipment_id') ?? '');
  if (!id) back(`/freight/shipments/${shipment_id}`, 'Invalid request');

  const free_time_days = formData.get('free_time_days') ? Number(formData.get('free_time_days')) : null;
  const discharge_date = String(formData.get('discharge_date') ?? '') || null;
  const gate_out_date = String(formData.get('gate_out_date') ?? '') || null;
  const returned_date = String(formData.get('returned_date') ?? '') || null;
  const status = String(formData.get('status') ?? '') || null;
  const num = (k: string) => (formData.get(k) ? Number(formData.get(k)) : null);
  const demurrage_rate = num('demurrage_rate');
  const detention_rate = num('detention_rate');
  const storage_rate = num('storage_rate');
  const rate_currency = String(formData.get('rate_currency') ?? '').trim().toUpperCase() || null;

  // recompute chargeable days AND estimated penalty from the entered dates + rates
  const ft = computeFreeTime({
    free_time_days, discharge_date, gate_out_date, returned_date,
    demurrage_rate, detention_rate, storage_rate, rate_currency,
  });

  const patch: Record<string, unknown> = {
    free_time_days, discharge_date, gate_out_date, returned_date,
    demurrage_rate, detention_rate, storage_rate, rate_currency,
    demurrage_days: ft.demurrageDays, detention_days: ft.detentionDays, est_penalty: ft.estPenalty,
  };
  if (status) patch.status = status;

  const { error } = await freight.from('containers').update(patch).eq('id', id).eq('company_id', companyId);
  if (error) back(`/freight/shipments/${shipment_id}`, error.message);
  revalidatePath(`/freight/shipments/${shipment_id}`);
  back(`/freight/shipments/${shipment_id}`);
}

export async function recordManualTracking(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const container_id = String(formData.get('container_id') ?? '') || null;
  const shipment_id = String(formData.get('shipment_id') ?? '');
  const event_type = String(formData.get('event_type') ?? '').trim();
  const location = String(formData.get('location') ?? '').trim() || null;
  const eta = String(formData.get('eta') ?? '') || null;
  if (!shipment_id || !event_type) back(`/freight/shipments/${shipment_id}`, 'Event type is required');

  await freight.from('tracking_events').insert({
    company_id: companyId, container_id, shipment_id, source: 'manual',
    event_type, location, eta: eta ? new Date(eta).toISOString() : null, occurred_at: new Date().toISOString(),
  });
  if (location && container_id) await freight.from('containers').update({ current_location: location }).eq('id', container_id).eq('company_id', companyId);
  if (eta) await freight.from('shipments').update({ eta }).eq('id', shipment_id).eq('company_id', companyId);

  revalidatePath(`/freight/shipments/${shipment_id}`);
  back(`/freight/shipments/${shipment_id}`);
}

export async function refreshContainerTracking(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const container_id = String(formData.get('container_id') ?? '');
  const shipment_id = String(formData.get('shipment_id') ?? '');
  const carrier_key = String(formData.get('carrier_key') ?? 'manual');
  const container_no = String(formData.get('container_no') ?? '').trim();
  if (!container_no) back(`/freight/shipments/${shipment_id}`, 'Container needs a number to track');

  const provider = getTrackingProvider(carrier_key);
  const result = await provider.fetch(container_no);
  if (!result.ok || !result.update) {
    back(`/freight/shipments/${shipment_id}`, result.message ?? 'No tracking available — record it manually');
  }

  const upd = result.update!;
  if (upd.events?.length) {
    await freight.from('tracking_events').insert(
      upd.events.map((e) => ({
        company_id: companyId, container_id, shipment_id, source: carrier_key,
        event_type: e.event_type, location: e.location ?? null, vessel: e.vessel ?? null,
        voyage: e.voyage ?? null, occurred_at: e.occurred_at ?? null, raw: e.raw ?? null,
        eta: upd.eta ?? null,
      })),
    );
  }
  if (upd.current_location) await freight.from('containers').update({ current_location: upd.current_location }).eq('id', container_id).eq('company_id', companyId);
  if (upd.eta) await freight.from('shipments').update({ eta: upd.eta.slice(0, 10) }).eq('id', shipment_id).eq('company_id', companyId);

  revalidatePath(`/freight/shipments/${shipment_id}`);
  back(`/freight/shipments/${shipment_id}`);
}

// ============================================================================= PAYMENT & RELEASE
// Operational AR + the cargo-release gate (integration audit P0): don't release the
// shipment / issue the delivery order until the customer has paid (unless on
// open-account terms or an explicit finance override).

async function recomputeAmountPaid(shipmentId: string, companyId: string, freight: any): Promise<number> {
  const { data } = await freight.from('shipment_payments').select('amount').eq('company_id', companyId).eq('shipment_id', shipmentId);
  return ((data as { amount: number }[] | null) ?? []).reduce((s, r) => s + Number(r.amount || 0), 0);
}

export async function setShipmentBilling(formData: FormData): Promise<void> {
  const { freight, companyId } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const shipment_id = String(formData.get('shipment_id') ?? '');
  const invoice_total = Number(formData.get('invoice_total') ?? 0) || 0;
  const payment_terms = String(formData.get('payment_terms') ?? 'prepaid');
  if (!shipment_id) back('/freight/shipments', 'Missing shipment');
  if (!['prepaid', 'open_account'].includes(payment_terms)) back(`/freight/shipments/${shipment_id}`, 'Invalid terms');

  const { error } = await freight.from('shipment_billing')
    .upsert({ company_id: companyId, shipment_id, invoice_total, payment_terms }, { onConflict: 'company_id,shipment_id' });
  if (error) back(`/freight/shipments/${shipment_id}`, error.message);
  revalidatePath(`/freight/shipments/${shipment_id}`);
  back(`/freight/shipments/${shipment_id}`);
}

export async function recordShipmentPayment(formData: FormData): Promise<void> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const shipment_id = String(formData.get('shipment_id') ?? '');
  const amount = Number(formData.get('amount') ?? 0);
  const currency_code = String(formData.get('currency_code') ?? '').trim().toUpperCase() || null;
  const method = String(formData.get('method') ?? '').trim() || null;
  const reference = String(formData.get('reference') ?? '').trim() || null;
  const paid_at = String(formData.get('paid_at') ?? '') || null;
  if (!shipment_id || !(amount > 0)) back(`/freight/shipments/${shipment_id}`, 'Enter a payment amount');

  const { error } = await freight.from('shipment_payments').insert({
    company_id: companyId, shipment_id, amount, currency_code, method, reference, paid_at,
    recorded_by: ctx.user?.id ?? null,
  });
  if (error) back(`/freight/shipments/${shipment_id}`, error.message);

  const amount_paid = await recomputeAmountPaid(shipment_id, companyId, freight);
  await freight.from('shipment_billing')
    .upsert({ company_id: companyId, shipment_id, amount_paid }, { onConflict: 'company_id,shipment_id' });
  revalidatePath(`/freight/shipments/${shipment_id}`);
  back(`/freight/shipments/${shipment_id}`);
}

export async function releaseShipment(formData: FormData): Promise<void> {
  const { freight, companyId, ctx } = await freightDb();
  if (!companyId) back('/freight/shipments', 'No active company');
  const shipment_id = String(formData.get('shipment_id') ?? '');
  const override = String(formData.get('override') ?? '') === 'on';
  if (!shipment_id) back('/freight/shipments', 'Missing shipment');

  const { data: b } = await freight.from('shipment_billing')
    .select('invoice_total, amount_paid, payment_terms, released').eq('company_id', companyId).eq('shipment_id', shipment_id).maybeSingle();
  const billing = b as any;
  const paidInFull = billing && Number(billing.invoice_total) > 0 && Number(billing.amount_paid) >= Number(billing.invoice_total);
  const openAccount = billing?.payment_terms === 'open_account';

  if (!paidInFull && !openAccount && !override) {
    back(`/freight/shipments/${shipment_id}`, 'Payment outstanding — cannot release. Record payment, or tick "override" to release on credit.');
  }

  const { error } = await freight.from('shipment_billing').upsert({
    company_id: companyId, shipment_id, released: true, released_override: override,
    released_at: new Date().toISOString(), released_by: ctx.user?.id ?? null,
  }, { onConflict: 'company_id,shipment_id' });
  if (error) back(`/freight/shipments/${shipment_id}`, error.message);
  revalidatePath(`/freight/shipments/${shipment_id}`);
  back(`/freight/shipments/${shipment_id}`);
}
