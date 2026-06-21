// Pure (non-server) helpers for the AccountEdge Pro / MYOB importer: a resilient
// delimited-text parser, the AccountEdge → seeded-account-type mapping, and the
// shared payload/result types. Kept in its own module (no 'use server') so it can be
// imported by BOTH the client wizard and the server actions in ./importing.ts — a
// 'use server' file may only export async functions, so the synchronous parser and
// the type/interface declarations cannot live there.

import type { AccountCategory } from './queries';

// -----------------------------------------------------------------------------
// Parser — delimited text (tab or comma), with a header row and quoted fields.
// -----------------------------------------------------------------------------

export interface ParsedDelimited {
  headers: string[];
  rows: string[][];
  /** The delimiter that was detected — '\t' or ','. */
  delimiter: '\t' | ',';
}

/**
 * Parse AccountEdge/MYOB-style delimited text. Auto-detects tab vs comma from the
 * first non-empty line, strips a UTF-8 BOM, handles RFC-4180 quoted fields (with
 * doubled "" escapes and embedded delimiters/newlines), and treats the first row as
 * the header. Resilient: never throws on ragged rows — short rows are kept as-is and
 * long rows are kept whole so nothing is silently dropped.
 */
export function parseDelimited(text: string): ParsedDelimited {
  // Strip BOM and normalize line endings.
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  // Detect the delimiter from the first non-empty line: AccountEdge defaults to tab,
  // but comma-separated exports are also common. Pick whichever appears more often,
  // preferring tab on a tie (AccountEdge's default).
  const firstLine = clean.split('\n').find((l) => l.trim().length > 0) ?? '';
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const delimiter: '\t' | ',' = commas > tabs ? ',' : '\t';

  const records = parseRecords(clean, delimiter);
  if (records.length === 0) return { headers: [], rows: [], delimiter };

  const headers = records[0].map((h) => h.trim());
  // Drop fully-blank rows (common trailers in exports) but keep partial rows.
  const rows = records.slice(1).filter((r) => r.some((c) => c.trim().length > 0));
  return { headers, rows, delimiter };
}

/** Tokenize the whole document into records of fields, honouring quotes. */
function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let started = false; // whether the current record has any content

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
    } else if (ch === delimiter) {
      pushField();
      started = true;
    } else if (ch === '\n') {
      if (started || field.length > 0 || record.length > 0) pushRecord();
    } else {
      field += ch;
      started = true;
    }
  }
  // Flush the final record if the file does not end with a newline.
  if (started || field.length > 0 || record.length > 0) pushRecord();
  return records;
}

// -----------------------------------------------------------------------------
// Account-type mapping — AccountEdge → seeded accounting.account_types
// -----------------------------------------------------------------------------

/**
 * AccountEdge account numbers are prefixed by a single digit that encodes the
 * statement category: 1 asset, 2 liability, 3 equity, 4 income, 5 cost of sales,
 * 6 expense (5 and 6 both roll into the expense category). We map that prefix to a
 * sensible default account-type key from the seeded set.
 */
const PREFIX_TO_TYPE_KEY: Record<string, string> = {
  '1': 'current_asset',
  '2': 'current_liability',
  '3': 'equity',
  '4': 'income',
  '5': 'cost_of_goods_sold',
  '6': 'expense',
};

const CATEGORY_DEFAULT_TYPE_KEY: Record<AccountCategory, string> = {
  asset: 'current_asset',
  liability: 'current_liability',
  equity: 'equity',
  income: 'income',
  expense: 'expense',
};

/** A free-text AccountEdge "Account Type" string → a seeded account-type key. */
const TYPE_TEXT_TO_KEY: Record<string, string> = {
  bank: 'bank',
  'current asset': 'current_asset',
  'other current asset': 'current_asset',
  'accounts receivable': 'accounts_receivable',
  receivable: 'accounts_receivable',
  'trade debtors': 'accounts_receivable',
  'fixed asset': 'fixed_asset',
  'other asset': 'other_asset',
  asset: 'current_asset',
  'current liability': 'current_liability',
  'other current liability': 'current_liability',
  'accounts payable': 'accounts_payable',
  payable: 'accounts_payable',
  'trade creditors': 'accounts_payable',
  'credit card': 'current_liability',
  'tax liability': 'tax_liability',
  'long term liability': 'long_term_liability',
  'long-term liability': 'long_term_liability',
  liability: 'current_liability',
  equity: 'equity',
  'retained earnings': 'retained_earnings',
  income: 'income',
  revenue: 'income',
  'other income': 'other_income',
  'cost of sales': 'cost_of_goods_sold',
  'cost of goods sold': 'cost_of_goods_sold',
  expense: 'expense',
  'other expense': 'other_expense',
};

/** A category keyword in a free-text type string, as a fallback. */
function categoryFromText(typeText: string): AccountCategory | null {
  const t = typeText.toLowerCase();
  if (/(asset|bank|receivable|debtor)/.test(t)) return 'asset';
  if (/(liabilit|payable|creditor|card)/.test(t)) return 'liability';
  if (/(equity|capital|retained)/.test(t)) return 'equity';
  if (/(income|revenue|sales)/.test(t)) return 'income';
  if (/(expense|cost)/.test(t)) return 'expense';
  return null;
}

/**
 * Resolve an account-type key for one row. Preference order:
 *  1. an explicit AccountEdge "Account Type" text we recognize,
 *  2. a category keyword in that text,
 *  3. the leading digit of the AccountEdge account number (1-6),
 *  4. a safe default ('current_asset').
 */
export function resolveAccountTypeKey(
  rawCode: string,
  typeText: string | undefined,
  validKeys: Set<string>,
): { key: string; inferred: 'type-text' | 'category-text' | 'prefix' | 'default' } {
  const text = (typeText ?? '').trim().toLowerCase();
  if (text) {
    const direct = TYPE_TEXT_TO_KEY[text];
    if (direct && validKeys.has(direct)) return { key: direct, inferred: 'type-text' };
    const cat = categoryFromText(text);
    if (cat) {
      const key = CATEGORY_DEFAULT_TYPE_KEY[cat];
      if (validKeys.has(key)) return { key, inferred: 'category-text' };
    }
  }
  const prefix = rawCode.trim().match(/[1-6]/)?.[0] ?? '';
  const byPrefix = PREFIX_TO_TYPE_KEY[prefix];
  if (byPrefix && validKeys.has(byPrefix)) return { key: byPrefix, inferred: 'prefix' };
  const fallback = validKeys.has('current_asset') ? 'current_asset' : [...validKeys][0];
  return { key: fallback, inferred: 'default' };
}

/** AccountEdge numbers like "1-1100" are kept verbatim; only whitespace is trimmed. */
export function normalizeCode(raw: string): string {
  return raw.trim();
}

/** Derive a short, unique code from a card name (e.g. "Acme Ltd" → "ACME"). */
export function deriveCode(name: string, used: Set<string>): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 8) || 'CARD';
  let code = base;
  let n = 1;
  while (used.has(code.toUpperCase())) {
    code = `${base.slice(0, 6)}${n}`;
    n++;
  }
  return code;
}

/** Read a trimmed cell by (possibly null/out-of-range) column index. */
export function cell(row: string[], idx: number | null): string {
  return idx === null || idx < 0 || idx >= row.length ? '' : (row[idx] ?? '').trim();
}

// -----------------------------------------------------------------------------
// Shared payload / result types
// -----------------------------------------------------------------------------

export interface ColumnMapping {
  code: number | null;
  name: number | null;
  type: number | null;
  email: number | null;
}

export interface ImportPayload {
  rows: string[][];
  mapping: ColumnMapping;
}

export interface ImportResult {
  error?: string;
  imported?: number;
  skipped?: number;
  batchId?: string;
  reports?: RowReport[];
}

// -----------------------------------------------------------------------------
// Dry-run classification — decide each row's fate BEFORE committing, with reasons.
// Pure so the dry-run and the commit share one source of truth.
// -----------------------------------------------------------------------------

export type RowStatus = 'create' | 'exists' | 'duplicate-in-file' | 'error';

export interface RowReport {
  index: number; // 1-based source row number
  code: string;
  name: string;
  status: RowStatus;
  detail: string;
}

export interface ImportPreview {
  error?: string;
  reports: RowReport[];
  summary: { total: number; create: number; exists: number; duplicateInFile: number; error: number };
}

export interface PreparedAccount {
  code: string;
  name: string;
  account_type_id: string;
  is_bank_account: boolean;
}
export interface PreparedCard {
  code: string;
  name: string;
  email: string | null;
}

export function summarize(reports: RowReport[]): ImportPreview['summary'] {
  const s = { total: reports.length, create: 0, exists: 0, duplicateInFile: 0, error: 0 };
  for (const r of reports) {
    if (r.status === 'create') s.create++;
    else if (r.status === 'exists') s.exists++;
    else if (r.status === 'duplicate-in-file') s.duplicateInFile++;
    else s.error++;
  }
  return s;
}

/** Classify chart-of-accounts rows. existingCodes are codes already in the company. */
export function classifyAccountRows(
  rows: string[][],
  mapping: ColumnMapping,
  idByKey: Map<string, string>,
  validKeys: Set<string>,
  existingCodes: Set<string>,
): { reports: RowReport[]; toInsert: PreparedAccount[] } {
  const reports: RowReport[] = [];
  const toInsert: PreparedAccount[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const index = i + 1;
    const code = normalizeCode(cell(row, mapping.code));
    const name = cell(row, mapping.name);
    if (!code || !name) {
      reports.push({ index, code, name, status: 'error', detail: !code && !name ? 'Missing code and name' : !code ? 'Missing code' : 'Missing name' });
      return;
    }
    if (seen.has(code)) {
      reports.push({ index, code, name, status: 'duplicate-in-file', detail: 'Same code appears earlier in this file' });
      return;
    }
    seen.add(code);
    if (existingCodes.has(code)) {
      reports.push({ index, code, name, status: 'exists', detail: 'Account already exists — skipped' });
      return;
    }
    const typeText = mapping.type !== null ? cell(row, mapping.type) : '';
    const { key, inferred } = resolveAccountTypeKey(code, typeText, validKeys);
    toInsert.push({ code, name, account_type_id: idByKey.get(key)!, is_bank_account: key === 'bank' });
    reports.push({ index, code, name, status: 'create', detail: `Type: ${key.replace(/_/g, ' ')}${inferred === 'prefix' || inferred === 'default' ? ' (inferred)' : ''}` });
  });
  return { reports, toInsert };
}

/** Classify customer/vendor card rows. existingCodesUpper are upper-cased existing codes. */
export function classifyCardRows(
  rows: string[][],
  mapping: ColumnMapping,
  existingCodesUpper: Set<string>,
): { reports: RowReport[]; toInsert: PreparedCard[] } {
  const reports: RowReport[] = [];
  const toInsert: PreparedCard[] = [];
  const used = new Set<string>();
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const index = i + 1;
    const name = cell(row, mapping.name);
    if (!name) {
      reports.push({ index, code: '', name: '', status: 'error', detail: 'Missing name' });
      return;
    }
    let code = mapping.code !== null ? cell(row, mapping.code) : '';
    const derived = !code;
    if (!code) code = deriveCode(name, used);
    used.add(code.toUpperCase());
    const upper = code.toUpperCase();
    if (seen.has(upper)) {
      reports.push({ index, code, name, status: 'duplicate-in-file', detail: 'Same code appears earlier in this file' });
      return;
    }
    seen.add(upper);
    if (existingCodesUpper.has(upper)) {
      reports.push({ index, code, name, status: 'exists', detail: 'Already exists — skipped' });
      return;
    }
    const emailRaw = mapping.email !== null ? cell(row, mapping.email) : '';
    const email = emailRaw && /@/.test(emailRaw) ? emailRaw : null;
    toInsert.push({ code, name, email });
    reports.push({ index, code, name, status: 'create', detail: derived ? 'Code derived from name' : (email ? '' : 'No email') });
  });
  return { reports, toInsert };
}
