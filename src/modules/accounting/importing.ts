// AccountEdge Pro / MYOB migration importer — 'use server' actions.
//
// AccountEdge exports TAB-DELIMITED (or comma-separated) text files via its Export
// Assistant — an "Accounts" list, and "Cards" for customers/vendors. These actions
// stage the source rows by recording an accounting.import_batches header (source_system
// 'accountedge', row_count, error_count rollup, terminal status) and write the live
// master records (accounts / customers / suppliers).
//
// Staging philosophy (docs/import-architecture.md): the raw rows are never lost — every
// import is an auditable, re-runnable batch. The pure parser, the AccountEdge→type
// mapping, and the shared types live in ./import-parse.ts (a 'use server' module may
// only export async functions). This module imports the data context only; it does not
// edit context.ts / queries.ts / actions.ts.

'use server';

import { accountingDb } from './context';
import {
  resolveAccountTypeKey,
  normalizeCode,
  deriveCode,
  cell,
  type ColumnMapping,
  type ImportPayload,
  type ImportResult,
} from './import-parse';

// -----------------------------------------------------------------------------
// Import: Chart of Accounts
// -----------------------------------------------------------------------------

export async function importAccounts(payload: ImportPayload): Promise<ImportResult> {
  const { acc, companyId, ctx } = await accountingDb();
  if (!companyId) return { error: 'No active company.' };

  const mapping: ColumnMapping = payload.mapping ?? { code: null, name: null, type: null, email: null };
  if (mapping.code === null || mapping.name === null) {
    return { error: 'Map at least the Code and Name columns before importing.' };
  }
  const sourceRows = payload.rows ?? [];
  if (sourceRows.length === 0) return { error: 'There are no rows to import.' };

  // Seeded account types — id + key, plus the set of valid keys for resolution.
  const { data: types, error: typeErr } = await acc.from('account_types').select('id, key');
  if (typeErr) return { error: typeErr.message };
  const idByKey = new Map((types ?? []).map((t: { id: string; key: string }) => [t.key, t.id]));
  const validKeys = new Set(idByKey.keys());
  if (validKeys.size === 0) return { error: 'No account types are configured.' };

  // Record the batch up front so the source is always traceable, even on failure.
  const { data: batch, error: batchErr } = await acc
    .from('import_batches')
    .insert({
      company_id: companyId,
      import_type: 'chart_of_accounts',
      source_system: 'accountedge',
      status: 'validating',
      row_count: sourceRows.length,
      created_by: ctx.user?.id ?? null,
    })
    .select('id')
    .single();
  if (batchErr || !batch) return { error: batchErr?.message ?? 'Could not start the import batch.' };

  // Build candidate rows; de-dupe within the file (last wins) and skip blanks.
  const byCode = new Map<string, { code: string; name: string; account_type_id: string; is_bank_account: boolean }>();
  let skipped = 0;
  for (const row of sourceRows) {
    const code = normalizeCode(cell(row, mapping.code));
    const name = cell(row, mapping.name);
    if (!code || !name) {
      skipped++;
      continue;
    }
    const typeText = mapping.type !== null ? cell(row, mapping.type) : '';
    const { key } = resolveAccountTypeKey(code, typeText, validKeys);
    byCode.set(code, {
      code,
      name,
      account_type_id: idByKey.get(key)!,
      is_bank_account: key === 'bank',
    });
  }

  const candidates = [...byCode.values()];
  if (candidates.length === 0) {
    await acc.from('import_batches').update({ status: 'failed', error_count: skipped }).eq('id', batch.id);
    return { error: 'No valid rows found — check that Code and Name map to real columns.', batchId: batch.id };
  }

  // Skip accounts that already exist — the unique (company_id, code) guard would
  // otherwise abort the whole insert. Import only the genuinely new codes.
  const { data: existing } = await acc
    .from('accounts')
    .select('code')
    .eq('company_id', companyId)
    .in('code', candidates.map((c) => c.code));
  const existingCodes = new Set((existing ?? []).map((e: { code: string }) => e.code));

  const toInsert = candidates
    .filter((c) => !existingCodes.has(c.code))
    .map((c) => ({ company_id: companyId, ...c }));
  const duplicates = candidates.length - toInsert.length;

  let imported = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error: insErr } = await acc.from('accounts').insert(toInsert).select('id');
    if (insErr) {
      await acc.from('import_batches').update({ status: 'failed', error_count: sourceRows.length }).eq('id', batch.id);
      return { error: insErr.message, batchId: batch.id };
    }
    imported = inserted?.length ?? toInsert.length;
  }

  await acc.from('import_batches').update({ status: 'committed', error_count: skipped }).eq('id', batch.id);
  return { imported, skipped: skipped + duplicates, batchId: batch.id };
}

// -----------------------------------------------------------------------------
// Import: Customer / Vendor cards
// -----------------------------------------------------------------------------

export async function importCards(payload: ImportPayload, kind: 'customer' | 'supplier'): Promise<ImportResult> {
  const { acc, companyId, ctx } = await accountingDb();
  if (!companyId) return { error: 'No active company.' };
  if (kind !== 'customer' && kind !== 'supplier') return { error: 'Invalid card type.' };

  const mapping: ColumnMapping = payload.mapping ?? { code: null, name: null, type: null, email: null };
  if (mapping.name === null) return { error: 'Map at least the Name column before importing.' };
  const sourceRows = payload.rows ?? [];
  if (sourceRows.length === 0) return { error: 'There are no rows to import.' };

  const table = kind === 'customer' ? 'customers' : 'suppliers';
  const importType = kind === 'customer' ? 'customers' : 'suppliers';

  const { data: batch, error: batchErr } = await acc
    .from('import_batches')
    .insert({
      company_id: companyId,
      import_type: importType,
      source_system: 'accountedge',
      status: 'validating',
      row_count: sourceRows.length,
      created_by: ctx.user?.id ?? null,
    })
    .select('id')
    .single();
  if (batchErr || !batch) return { error: batchErr?.message ?? 'Could not start the import batch.' };

  // Build records. When no Code column is mapped, derive a stable code from the name
  // so the unique (company_id, code) constraint is satisfied; de-dupe within the file.
  const used = new Set<string>();
  const byCode = new Map<string, { code: string; name: string; email: string | null }>();
  let skipped = 0;
  for (const row of sourceRows) {
    const name = cell(row, mapping.name);
    if (!name) {
      skipped++;
      continue;
    }
    let code = mapping.code !== null ? cell(row, mapping.code) : '';
    if (!code) code = deriveCode(name, used);
    used.add(code.toUpperCase());
    const emailRaw = mapping.email !== null ? cell(row, mapping.email) : '';
    const email = emailRaw && /@/.test(emailRaw) ? emailRaw : null;
    byCode.set(code.toUpperCase(), { code, name, email });
  }

  const candidates = [...byCode.values()];
  if (candidates.length === 0) {
    await acc.from('import_batches').update({ status: 'failed', error_count: skipped }).eq('id', batch.id);
    return { error: 'No valid rows found — check that the Name column is mapped.', batchId: batch.id };
  }

  const { data: existing } = await acc
    .from(table)
    .select('code')
    .eq('company_id', companyId)
    .in('code', candidates.map((c) => c.code));
  const existingCodes = new Set((existing ?? []).map((e: { code: string }) => e.code));

  const toInsert = candidates
    .filter((c) => !existingCodes.has(c.code))
    .map((c) => ({ company_id: companyId, code: c.code, name: c.name, email: c.email }));
  const duplicates = candidates.length - toInsert.length;

  let imported = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error: insErr } = await acc.from(table).insert(toInsert).select('id');
    if (insErr) {
      await acc.from('import_batches').update({ status: 'failed', error_count: sourceRows.length }).eq('id', batch.id);
      return { error: insErr.message, batchId: batch.id };
    }
    imported = inserted?.length ?? toInsert.length;
  }

  await acc.from('import_batches').update({ status: 'committed', error_count: skipped }).eq('id', batch.id);
  return { imported, skipped: skipped + duplicates, batchId: batch.id };
}
