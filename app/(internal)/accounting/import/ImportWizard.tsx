'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseDelimited, type ColumnMapping, type ImportPreview, type ImportResult, type RowReport, type RowStatus } from '@/modules/accounting/import-parse';
import { validateImport, importAccounts, importCards } from '@/modules/accounting/importing';

type ImportType = 'accounts' | 'customers' | 'suppliers';
type Field = keyof ColumnMapping;

const TYPE_LABEL: Record<ImportType, string> = { accounts: 'Chart of Accounts', customers: 'Customers', suppliers: 'Suppliers' };
const KIND: Record<ImportType, 'accounts' | 'customer' | 'supplier'> = { accounts: 'accounts', customers: 'customer', suppliers: 'supplier' };

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
    if (idx >= 0) { m[field] = idx; taken.add(idx); }
  }
  return m;
}

const STATUS_BADGE: Record<RowStatus, { cls: string; label: string }> = {
  create: { cls: 'badge-success', label: 'New' },
  exists: { cls: 'badge-neutral', label: 'Exists' },
  'duplicate-in-file': { cls: 'badge-warning', label: 'Duplicate' },
  error: { cls: 'badge-danger', label: 'Error' },
};

const MAX_REPORT_ROWS = 300;

export function ImportWizard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [type, setType] = useState<ImportType>('accounts');
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][]; delimiter: '\t' | ',' } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ code: null, name: null, type: null, email: null });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const content = String(reader.result ?? ''); setText(content); doParse(content, type); };
    reader.onerror = () => setError('Could not read that file. Try pasting its contents instead.');
    reader.readAsText(file);
  }

  function doParse(source: string, t: ImportType) {
    setError(null); setResult(null); setPreview(null);
    if (!source.trim()) { setParsed(null); return; }
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
    setType(t); setResult(null); setPreview(null);
    if (parsed) setMapping(autoMap(parsed.headers, t));
  }

  function setField(field: Field, value: string) {
    setMapping((m) => ({ ...m, [field]: value === '' ? null : Number(value) }));
    setPreview(null); setResult(null);
  }

  const fields = FIELDS_FOR[type];
  const missingRequired = fields.filter((f) => f.required && mapping[f.field] === null);
  const canValidate = parsed !== null && missingRequired.length === 0 && !pending;

  function runValidate() {
    if (!parsed) return;
    setError(null); setResult(null);
    startTransition(async () => {
      const pv = await validateImport({ rows: parsed.rows, mapping }, KIND[type]);
      if (pv.error) { setError(pv.error); setPreview(null); return; }
      setPreview(pv);
    });
  }

  function runImport() {
    if (!parsed) return;
    setError(null);
    const payload = { rows: parsed.rows, mapping };
    startTransition(async () => {
      const res = type === 'accounts' ? await importAccounts(payload) : await importCards(payload, KIND[type] as 'customer' | 'supplier');
      if (res.error) { setError(res.error); return; }
      setResult(res); setPreview(null); router.refresh();
    });
  }

  const reports = result?.reports ?? preview?.reports ?? [];
  const summary = preview?.summary;

  return (
    <div style={{ maxWidth: 1100 }}>
      {error ? <div role="alert" className="card" style={bannerStyle('danger')}>{error}</div> : null}

      {result ? (
        <div role="status" className="card" style={bannerStyle('success')}>
          Imported <strong>{result.imported ?? 0}</strong> {TYPE_LABEL[type].toLowerCase()} record{result.imported === 1 ? '' : 's'}
          {result.skipped ? <> · {result.skipped} skipped (already present, duplicate or invalid)</> : null}. The original data is unchanged; this run is recorded as an import batch.
        </div>
      ) : null}

      {/* Step 1 — source + type */}
      <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 660 }}>
        <div className="field">
          <label className="label" htmlFor="import-type">What are you importing?</label>
          <select id="import-type" className="input" value={type} onChange={(e) => changeType(e.target.value as ImportType)}>
            <option value="accounts">Chart of Accounts</option>
            <option value="customers">Customers</option>
            <option value="suppliers">Suppliers</option>
          </select>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label className="label" htmlFor="paste">Paste the exported text</label>
          <textarea id="paste" className="input" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => doParse(text, type)}
            placeholder={'Account Number\tAccount Name\tAccount Type\n1-1100\tBusiness Bank Account\tBank'} rows={6} spellCheck={false}
            style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-sm)', resize: 'vertical' }} />
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>Choose .txt / .csv file</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => doParse(text, type)} disabled={!text.trim()}>Parse</button>
          <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv,text/tab-separated-values" onChange={handleFile} style={{ display: 'none' }} />
        </div>
      </div>

      {/* Step 2 — column mapping */}
      {parsed ? (
        <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 660 }}>
          <h3 style={{ fontSize: 'var(--text-base)', margin: '0 0 4px' }}>Map the columns</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 'var(--text-sm)' }}>
            Detected {parsed.delimiter === '\t' ? 'tab-delimited' : 'comma-separated'} data with {parsed.headers.length} column{parsed.headers.length === 1 ? '' : 's'} and {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}.
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            {fields.map((f) => (
              <div key={f.field} style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, alignItems: 'center' }}>
                <label className="label" htmlFor={`map-${f.field}`} style={{ margin: 0 }}>{f.label}{f.required ? <span style={{ color: 'var(--danger)' }}> *</span> : null}</label>
                <select id={`map-${f.field}`} className="input" value={mapping[f.field] === null ? '' : String(mapping[f.field])} onChange={(e) => setField(f.field, e.target.value)}>
                  <option value="">— not mapped —</option>
                  {parsed.headers.map((h, i) => (<option key={i} value={i}>{h || `Column ${i + 1}`}</option>))}
                </select>
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={runValidate} disabled={!canValidate}>
              {pending && !result ? 'Validating…' : 'Validate'}
            </button>
            {missingRequired.length > 0 ? (
              <span style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', alignSelf: 'center' }}>
                Map: {missingRequired.map((f) => f.label.replace(/\s*\(optional\)/i, '')).join(', ')}.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Step 3 — validation report (dry-run) */}
      {summary ? (
        <div style={{ marginBottom: 16 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="badge badge-success">{summary.create} new</span>
            {summary.exists > 0 ? <span className="badge badge-neutral">{summary.exists} already exist</span> : null}
            {summary.duplicateInFile > 0 ? <span className="badge badge-warning">{summary.duplicateInFile} duplicate{summary.duplicateInFile === 1 ? '' : 's'} in file</span> : null}
            {summary.error > 0 ? <span className="badge badge-danger">{summary.error} error{summary.error === 1 ? '' : 's'}</span> : null}
          </div>
          <ReportTable reports={reports} />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={runImport} disabled={pending || summary.create === 0}>
              {pending ? 'Importing…' : summary.create === 0 ? 'Nothing new to import' : `Import ${summary.create} new record${summary.create === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      ) : result?.reports ? (
        <ReportTable reports={result.reports} />
      ) : null}
    </div>
  );
}

function ReportTable({ reports }: { reports: RowReport[] }) {
  const shown = reports.slice(0, MAX_REPORT_ROWS);
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="num" style={{ width: 50 }}>#</th>
              <th style={{ width: 90 }}>Status</th>
              <th style={{ width: 140 }}>Code</th>
              <th>Name</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const b = STATUS_BADGE[r.status];
              return (
                <tr key={r.index}>
                  <td className="num muted">{r.index}</td>
                  <td><span className={`badge ${b.cls}`}>{b.label}</span></td>
                  <td>{r.code || <span className="muted">—</span>}</td>
                  <td>{r.name || <span className="muted">—</span>}</td>
                  <td className="muted">{r.detail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {reports.length > MAX_REPORT_ROWS ? (
        <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 8 }}>Showing the first {MAX_REPORT_ROWS} of {reports.length} rows. All rows are still processed on import.</p>
      ) : null}
    </>
  );
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
