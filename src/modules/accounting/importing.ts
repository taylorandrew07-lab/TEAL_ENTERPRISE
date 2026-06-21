// AccountEdge Pro / MYOB migration importer — 'use server' actions.
//
// AccountEdge exports TAB-DELIMITED (or comma-separated) text via its Export Assistant
// (an "Accounts" list, and "Cards" for customers/vendors). Flow: validate (a DB-aware
// dry-run that classifies every row — create / already-exists / duplicate-in-file /
// error, with reasons) → commit (insert only the genuinely new rows). The raw source is
// never altered; every commit is recorded as an auditable accounting.import_batches row.
//
// The pure parser + classifiers + shared types live in ./import-parse.ts (a 'use server'
// module may only export async functions), so the dry-run and the commit share one
// source of truth and can never disagree.

'use server';

import { accountingDb } from './context';
import {
  classifyAccountRows,
  classifyCardRows,
  summarize,
  type ColumnMapping,
  type ImportPayload,
  type ImportResult,
  type ImportPreview,
} from './import-parse';

export type ImportKind = 'accounts' | 'customer' | 'supplier';

const emptyMapping = (): ColumnMapping => ({ code: null, name: null, type: null, email: null });
const previewError = (error: string): ImportPreview => ({
  error,
  reports: [],
  summary: { total: 0, create: 0, exists: 0, duplicateInFile: 0, error: 0 },
});

/** All existing codes for a company table (bounded — a migration chart/card list is small). */
async function existingCodes(acc: any, table: string, companyId: string): Promise<string[]> {
  const { data } = await acc.from(table).select('code').eq('company_id', companyId);
  return ((data as { code: string }[] | null) ?? []).map((r) => r.code).filter(Boolean);
}

async function accountTypeMaps(acc: any): Promise<{ idByKey: Map<string, string>; validKeys: Set<string> } | { error: string }> {
  const { data: types, error } = await acc.from('account_types').select('id, key');
  if (error) return { error: error.message };
  const idByKey = new Map<string, string>((types ?? []).map((t: { id: string; key: string }) => [t.key, t.id]));
  if (idByKey.size === 0) return { error: 'No account types are configured.' };
  return { idByKey, validKeys: new Set(idByKey.keys()) };
}

// -----------------------------------------------------------------------------
// Dry-run: classify every row against the database, with reasons. No writes.
// -----------------------------------------------------------------------------
export async function validateImport(payload: ImportPayload, kind: ImportKind): Promise<ImportPreview> {
  const { acc, companyId } = await accountingDb();
  if (!companyId) return previewError('No active company.');
  const mapping = payload.mapping ?? emptyMapping();
  const rows = payload.rows ?? [];
  if (rows.length === 0) return previewError('There are no rows to validate.');

  if (kind === 'accounts') {
    if (mapping.code === null || mapping.name === null) return previewError('Map the Code and Name columns first.');
    const maps = await accountTypeMaps(acc);
    if ('error' in maps) return previewError(maps.error);
    const existing = new Set(await existingCodes(acc, 'accounts', companyId));
    const { reports } = classifyAccountRows(rows, mapping, maps.idByKey, maps.validKeys, existing);
    return { reports, summary: summarize(reports) };
  }

  if (mapping.name === null) return previewError('Map the Name column first.');
  const table = kind === 'customer' ? 'customers' : 'suppliers';
  const existingUpper = new Set((await existingCodes(acc, table, companyId)).map((c) => c.toUpperCase()));
  const { reports } = classifyCardRows(rows, mapping, existingUpper);
  return { reports, summary: summarize(reports) };
}

// -----------------------------------------------------------------------------
// Commit: insert only the genuinely-new rows; record the batch; return per-row reports.
// -----------------------------------------------------------------------------
export async function importAccounts(payload: ImportPayload): Promise<ImportResult> {
  const { acc, companyId, ctx } = await accountingDb();
  if (!companyId) return { error: 'No active company.' };
  const mapping = payload.mapping ?? emptyMapping();
  if (mapping.code === null || mapping.name === null) return { error: 'Map at least the Code and Name columns before importing.' };
  const rows = payload.rows ?? [];
  if (rows.length === 0) return { error: 'There are no rows to import.' };

  const maps = await accountTypeMaps(acc);
  if ('error' in maps) return { error: maps.error };
  const existing = new Set(await existingCodes(acc, 'accounts', companyId));
  const { reports, toInsert } = classifyAccountRows(rows, mapping, maps.idByKey, maps.validKeys, existing);
  const summary = summarize(reports);

  const { data: batch } = await acc
    .from('import_batches')
    .insert({ company_id: companyId, import_type: 'chart_of_accounts', source_system: 'accountedge', status: 'validating', row_count: rows.length, created_by: ctx.user?.id ?? null })
    .select('id')
    .single();
  const batchId = (batch as { id: string } | null)?.id;

  let imported = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error: insErr } = await acc
      .from('accounts')
      .insert(toInsert.map((c) => ({ company_id: companyId, ...c })))
      .select('id');
    if (insErr) {
      if (batchId) await acc.from('import_batches').update({ status: 'failed', error_count: rows.length }).eq('id', batchId);
      return { error: insErr.message, batchId, reports };
    }
    imported = inserted?.length ?? toInsert.length;
  }
  if (batchId) await acc.from('import_batches').update({ status: 'committed', error_count: rows.length - imported }).eq('id', batchId);
  return { imported, skipped: summary.exists + summary.duplicateInFile + summary.error, batchId, reports };
}

export async function importCards(payload: ImportPayload, kind: 'customer' | 'supplier'): Promise<ImportResult> {
  const { acc, companyId, ctx } = await accountingDb();
  if (!companyId) return { error: 'No active company.' };
  if (kind !== 'customer' && kind !== 'supplier') return { error: 'Invalid card type.' };
  const mapping = payload.mapping ?? emptyMapping();
  if (mapping.name === null) return { error: 'Map at least the Name column before importing.' };
  const rows = payload.rows ?? [];
  if (rows.length === 0) return { error: 'There are no rows to import.' };

  const table = kind === 'customer' ? 'customers' : 'suppliers';
  const existingUpper = new Set((await existingCodes(acc, table, companyId)).map((c) => c.toUpperCase()));
  const { reports, toInsert } = classifyCardRows(rows, mapping, existingUpper);
  const summary = summarize(reports);

  const { data: batch } = await acc
    .from('import_batches')
    .insert({ company_id: companyId, import_type: kind === 'customer' ? 'customers' : 'suppliers', source_system: 'accountedge', status: 'validating', row_count: rows.length, created_by: ctx.user?.id ?? null })
    .select('id')
    .single();
  const batchId = (batch as { id: string } | null)?.id;

  let imported = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error: insErr } = await acc
      .from(table)
      .insert(toInsert.map((c) => ({ company_id: companyId, code: c.code, name: c.name, email: c.email })))
      .select('id');
    if (insErr) {
      if (batchId) await acc.from('import_batches').update({ status: 'failed', error_count: rows.length }).eq('id', batchId);
      return { error: insErr.message, batchId, reports };
    }
    imported = inserted?.length ?? toInsert.length;
  }
  if (batchId) await acc.from('import_batches').update({ status: 'committed', error_count: rows.length - imported }).eq('id', batchId);
  return { imported, skipped: summary.exists + summary.duplicateInFile + summary.error, batchId, reports };
}
