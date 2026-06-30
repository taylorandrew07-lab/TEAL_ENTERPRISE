import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { importContactsCsv } from '@/modules/freight/documents';

export const metadata = { title: 'Import contacts — Jupiter Logistics' };

export default async function ImportContactsPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('freight', 'freight.contacts.manage');
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/contacts">Contacts</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Import contacts from CSV</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>Bring your existing client/carrier/agent list across in one go. Paste the CSV or choose a file.</p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 700 }}>{error}</div>
      ) : null}

      <div className="card" style={{ padding: 16, maxWidth: 700, marginBottom: 16 }}>
        <strong style={{ fontSize: 'var(--text-sm)' }}>Expected columns (header row required)</strong>
        <p className="muted" style={{ fontSize: 'var(--text-sm)', margin: '6px 0 0' }}>
          <code>name</code> (required), <code>kind</code> (organization|person), <code>roles</code> (separated by <code>;</code> — e.g. <code>client;consignee</code>),
          {' '}<code>email</code>, <code>phone</code>, <code>country_code</code>, <code>payment_terms</code>, <code>notes</code>. Extra columns are ignored.
        </p>
        <pre className="muted" style={{ fontSize: 'var(--text-xs)', overflowX: 'auto', marginTop: 10, background: 'var(--surface-2)', padding: 10, borderRadius: 'var(--r-sm)' }}>
name,kind,roles,email,phone,country_code{'\n'}Maersk Line,organization,shipping_line,bookings@maersk.com,,DK{'\n'}Acme Imports Ltd,organization,client;consignee,ops@acme.tt,+1868...,TT</pre>
      </div>

      <form action={importContactsCsv} className="card" style={{ padding: 20, maxWidth: 700, display: 'grid', gap: 16 }} encType="multipart/form-data">
        <div className="field">
          <label className="label" htmlFor="file">CSV file</label>
          <input id="file" name="file" type="file" accept=".csv,text/csv" className="input" />
        </div>
        <div className="field">
          <label className="label" htmlFor="csv">…or paste CSV</label>
          <textarea id="csv" name="csv" className="input" rows={8} placeholder="name,kind,roles,email&#10;..." style={{ fontFamily: 'monospace', fontSize: 'var(--text-sm)' }} />
        </div>
        <div><button className="btn btn-primary" type="submit">Import contacts</button></div>
      </form>
    </div>
  );
}
