'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseDelimited, type ColumnMapping, type ImportResult } from '@/modules/accounting/import-parse';
import { importAccounts, importCards } from '@/modules/accounting/importing';

type ImportType = 'accounts' | 'customers' | 'suppliers';
type Field = keyof ColumnMapping; // 'code' | 'name' | 'type' | 'email'

const TYPE_LABEL: Record<ImportType, string> = {
  accounts: 'Chart of Accounts',
  customers: 'Customers',
  suppliers: 'Suppliers',
};

// Which canonical fields each import type maps, and which are required.
const FIELDS_FOR: Record<ImportType, { field: Field; label: string; required: boolean }[]> = {
  accounts: [
    { field: 'code', label: 'Account number / code', required: true },
    { field: 'name', label: 'Account name', required: true },
    { field: 'type', label: 'Account type (optional)', required: false },
  ],
  customers: [
    { field: 'code', label: 'Card ID / code (optional)', required: false },
    { field: 'name', label: 'Name', required: true },
    { field: 'email', label: 'Email (optional)', required: false },
  ],
  suppliers: [
    { field: 'code', label: 'Card ID / code (optional)', required: false },
    { field: 'name', label: 'Name', required: true },
    { field: 'email', label: 'Email (optional)', required: false },
  ],
};

const PREVIEW_ROWS = 10;

// Header-name heuristics for auto-mapping AccountEdge / MYOB exports.
const GUESS: Record<Field, RegExp> = {
  code: /(account\s*(no|number|#)|^a\/?c|card\s*id|^id$|^code$)/i,
  name: /(account\s*name|^name$|co\.?\/?last\s*name|company\s*name|^card\s*name)/i,
  type: /(account\s*type|^type$|category)/i,
  email: /(e-?mail)/i,
};

function autoMap(headers: string[], type: ImportType): ColumnMapping {
  const m: ColumnMapping = { code: null, name: null, type: null, email: null };
  const taken = new Set<number>();
  for (const { field } of FIELDS_FOR[type]) {
    const idx = headers.findIndex((h, i) => !taken.has(i) && GUESS[field].test(h));
    if (idx >= 0) {
      m[field] = idx;
      taken.add(idx);
    }
  }
  return m;
}

export function ImportWizard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [type, setType] = useState<ImportType>('accounts');
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][]; delimiter: '\t' | ',' } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ code: null, name: null, type: null, email: null });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const previewRows = useMemo(() => parsed?.rows.slice(0, PREVIEW_ROWS) ?? [], [parsed]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      setText(content);
      doParse(content, type);
    };
    reader.onerror = () => setError('Could not read that file. Try pasting its contents instead.');
    reader.readAsText(file);
  }

  function doParse(source: string, t: ImportType) {
    setError(null);
    setResult(null);
    if (!source.trim()) {
      setParsed(null);
      return;
    }
    const p = parseDelimited(source);
    if (p.headers.length === 0 || p.rows.length === 0) {
      setParsed(null);
      setError('No data rows found. Make sure the export includes a header row and at least one record.');
      return;
    }
    setParsed(p);
    setMapping(autoMap(p.headers, t));
  }

  function changeType(t: ImportType) {
    setType(t);
    setResult(null);
    if (parsed) setMapping(autoMap(parsed.headers, t));
  }

  function setField(field: Field, value: string) {
    const idx = value === '' ? null : Number(value);
    setMapping((m) => ({ ...m, [field]: idx }));
  }

  const fields = FIELDS_FOR[type];
  const missingRequired = fields.filter((f) => f.required && mapping[f.field] === null);
  const canImport = parsed !== null && missingRequired.length === 0 && !pending;

  function runImport() {
    if (!parsed) return;
    setError(null);
    setResult(null);
    const payload = { rows: parsed.rows, mapping };
    startTransition(async () => {
      const res =
        type === 'accounts'
          ? await importAccounts(payload)
          : await importCards(payload, type === 'customers' ? 'customer' : 'supplier');
      if (res.error) {
        setError(res.error);
        return;
      }
      setResult(res);
      router.refresh();
    });
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      {error ? (
        <div role="alert" className="card" style={bannerStyle('danger')}>
          {error}
        </div>
      ) : null}

      {result ? (
        <div role="status" className="card" style={bannerStyle('success')}>
          Imported <strong>{result.imported ?? 0}</strong> {TYPE_LABEL[type].toLowerCase()} record
          {result.imported === 1 ? '' : 's'}
          {result.skipped ? <> · {result.skipped} skipped (blank, duplicate or already present)</> : null}.
          The original data is unchanged and this run is recorded as an import batch.
        </div>
      ) : null}

      {/* Step 1 — source + type */}
      <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 660 }}>
        <div className="field">
          <label className="label" htmlFor="import-type">
            What are you importing?
          </label>
          <select
            id="import-type"
            className="input"
            value={type}
            onChange={(e) => changeType(e.target.value as ImportType)}
          >
            <option value="accounts">Chart of Accounts</option>
            <option value="customers">Customers</option>
            <option value="suppliers">Suppliers</option>
          </select>
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label className="label" htmlFor="paste">
            Paste the exported text
          </label>
          <textarea
            id="paste"
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => doParse(text, type)}
            placeholder={'Account Number\tAccount Name\tAccount Type\n1-1100\tBusiness Bank Account\tBank'}
            rows={6}
            spellCheck={false}
            style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-sm)', resize: 'vertical' }}
          />
        </div>

        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
            Choose .txt / .csv file
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => doParse(text, type)}
            disabled={!text.trim()}
          >
            Preview
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,text/plain,text/csv,text/tab-separated-values"
            onChange={handleFile}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* Step 2 — column mapping */}
      {parsed ? (
        <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 660 }}>
          <h3 style={{ fontSize: 'var(--text-base)', margin: '0 0 4px' }}>Map the columns</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 'var(--text-sm)' }}>
            Detected {parsed.delimiter === '\t' ? 'tab-delimited' : 'comma-separated'} data with{' '}
            {parsed.headers.length} column{parsed.headers.length === 1 ? '' : 's'} and {parsed.rows.length} row
            {parsed.rows.length === 1 ? '' : 's'}.
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            {fields.map((f) => (
              <div key={f.field} style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, alignItems: 'center' }}>
                <label className="label" htmlFor={`map-${f.field}`} style={{ margin: 0 }}>
                  {f.label}
                  {f.required ? <span style={{ color: 'var(--danger)' }}> *</span> : null}
                </label>
                <select
                  id={`map-${f.field}`}
                  className="input"
                  value={mapping[f.field] === null ? '' : String(mapping[f.field])}
                  onChange={(e) => setField(f.field, e.target.value)}
                >
                  <option value="">— not mapped —</option>
                  {parsed.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {missingRequired.length > 0 ? (
            <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', margin: '12px 0 0' }}>
              Map the required column{missingRequired.length === 1 ? '' : 's'}:{' '}
              {missingRequired.map((f) => f.label.replace(/\s*\(optional\)/i, '')).join(', ')}.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Step 3 — preview */}
      {parsed ? (
        <>
          <h3 style={{ fontSize: 'var(--text-base)', margin: '0 0 8px' }}>
            Preview <span className="muted" style={{ fontWeight: 400 }}>(first {Math.min(PREVIEW_ROWS, parsed.rows.length)} of {parsed.rows.length} rows)</span>
          </h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 44 }} className="num">
                    #
                  </th>
                  {parsed.headers.map((h, i) => (
                    <th key={i}>
                      {h || `Column ${i + 1}`}
                      <MappedTag mapping={mapping} index={i} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, r) => {
                  const flagged = isRowInvalid(row, mapping, type);
                  return (
                    <tr key={r} style={flagged ? { background: 'var(--warning-weak, var(--surface-2))' } : undefined}>
                      <td className="num muted">{r + 1}</td>
                      {parsed.headers.map((_, i) => (
                        <td key={i}>{row[i] ?? <span className="muted">—</span>}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={runImport} disabled={!canImport}>
              {pending ? 'Importing…' : `Import ${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MappedTag({ mapping, index }: { mapping: ColumnMapping; index: number }) {
  const field = (Object.keys(mapping) as (keyof ColumnMapping)[]).find((k) => mapping[k] === index);
  if (!field) return null;
  return (
    <span className="badge badge-brand" style={{ marginLeft: 8, textTransform: 'capitalize' }}>
      {field}
    </span>
  );
}

/** Flag a preview row that lacks the data a successful import needs. */
function isRowInvalid(row: string[], mapping: ColumnMapping, type: ImportType): boolean {
  const get = (idx: number | null) => (idx === null ? '' : (row[idx] ?? '').trim());
  if (type === 'accounts') return !get(mapping.code) || !get(mapping.name);
  return !get(mapping.name);
}

function bannerStyle(kind: 'danger' | 'success'): React.CSSProperties {
  const danger = kind === 'danger';
  return {
    borderColor: danger ? 'oklch(0.85 0.06 25)' : 'oklch(0.85 0.08 155)',
    background: danger ? 'var(--danger-weak)' : 'var(--success-weak, var(--surface-2))',
    color: danger ? 'var(--danger)' : 'var(--success, var(--ink))',
    padding: '10px 14px',
    fontSize: 'var(--text-sm)',
    marginBottom: 16,
    maxWidth: 660,
  };
}
