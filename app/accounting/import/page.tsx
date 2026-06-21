import { requireModule } from '@/core/session/guard';
import { ImportWizard } from './ImportWizard';

export const metadata = { title: 'Import from AccountEdge — TEAL Accounting' };

export default async function ImportPage() {
  await requireModule('accounting', 'imports.manage');

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Data</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Import from AccountEdge Pro</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 660 }}>
            Bring your chart of accounts and customer / vendor cards across from AccountEdge Pro or MYOB.
            Paste an export or choose the file, preview it, map the columns, then import. Your original is
            never altered, and every import is recorded as a batch.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: 18, marginBottom: 22, maxWidth: 660 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 8px' }}>How to export from AccountEdge</h2>
        <ol className="muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 'var(--text-sm)' }}>
          <li>
            In AccountEdge, open <strong>File → Export Data</strong> to start the Export Assistant.
          </li>
          <li>
            Choose <strong>Accounts</strong> (for the chart of accounts) or <strong>Cards</strong> (for
            customers / vendors).
          </li>
          <li>
            Select <strong>Tab-delimited</strong> (comma-separated also works) and{' '}
            <strong>Include field headings</strong>.
          </li>
          <li>Export the file, then paste its contents or upload the .txt / .csv below.</li>
        </ol>
      </div>

      <ImportWizard />
    </div>
  );
}
