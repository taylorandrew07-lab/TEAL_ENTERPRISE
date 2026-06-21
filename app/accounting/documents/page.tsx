import { requireModule } from '@/core/session/guard';
import { listDocuments, uploadDocument, deleteDocument } from '@/modules/documents/documents';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Documents — TEAL Accounting' };

export default async function DocumentsPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'documents.manage');
  const docs = await listDocuments();
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Data</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Documents</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 660 }}>
            Attach bank statements, supplier invoices, cargo paperwork — anything. Files are private to this
            company and stored securely; only people with document access can see or download them.
          </p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 660 }}>
          {error}
        </div>
      ) : null}

      <div className="card" style={{ padding: 18, marginBottom: 22, maxWidth: 660 }}>
        <h2 style={{ fontSize: 'var(--text-base)', margin: '0 0 10px' }}>Upload a document</h2>
        <form action={uploadDocument} className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="file" name="file" required className="input" style={{ maxWidth: 360, padding: '8px 10px' }} />
          <button type="submit" className="btn btn-primary">Upload</button>
        </form>
        <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '10px 0 0' }}>Up to 25 MB per file.</p>
      </div>

      {docs.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <p className="muted" style={{ margin: 0 }}>No documents yet. Upload your first file above.</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ maxWidth: 820 }}>
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th style={{ width: 140 }}>Type</th>
                <th className="date" style={{ width: 130 }}>Uploaded</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>
                    {d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">{d.filename}</a> : d.filename}
                  </td>
                  <td className="muted">{shortType(d.mime_type)}</td>
                  <td className="date">{formatDate(d.created_at)}</td>
                  <td>
                    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                      {d.url ? (
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Download</a>
                      ) : null}
                      <form action={deleteDocument}>
                        <input type="hidden" name="id" value={d.id} />
                        <button type="submit" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>Delete</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function shortType(mime: string | null): string {
  if (!mime) return '—';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/')) return mime.replace('image/', '').toUpperCase();
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return 'Spreadsheet';
  if (mime.includes('word') || mime.includes('document')) return 'Document';
  return mime.split('/').pop()?.slice(0, 12) ?? 'File';
}
