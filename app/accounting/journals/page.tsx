import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { formatDate, formatMoney } from '@/lib/format';
import { listJournalEntries, type JournalEntryRow } from '@/modules/accounting/queries';
import { reverseJournalEntry } from '@/modules/accounting/actions';

export const metadata = { title: 'Journal Entries — TEAL Accounting' };

export default async function JournalsPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'journals.manage');
  const entries = await listJournalEntries();
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Journal Entries</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Every financial event is a balanced journal entry. Posted entries are immutable.
          </p>
        </div>
        <Link href="/accounting/journals/new" className="btn btn-primary">
          New entry
        </Link>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 640 }}>
          {error}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No journal entries yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Post your first entry — for example, owner&apos;s opening capital, or a bank deposit. The ledger
            and trial balance update the moment you post.
          </p>
          <Link href="/accounting/journals/new" className="btn btn-primary">
            New entry
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="date" style={{ width: 110 }}>Date</th>
                <th style={{ width: 90 }}>No.</th>
                <th>Description</th>
                <th style={{ width: 100 }}>Status</th>
                <th className="num" style={{ width: 150 }}>Amount</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="date">{formatDate(e.entry_date)}</td>
                  <td style={{ fontWeight: 600 }}>{e.entry_no ?? '—'}</td>
                  <td>{e.description ?? <span className="muted">(no description)</span>}</td>
                  <td>
                    <EntryStatus status={e.status} />
                  </td>
                  <td className="num">{formatMoney(e.total, e.currency_code)}</td>
                  <td>
                    {e.status === 'posted' ? (
                      <form action={reverseJournalEntry}>
                        <input type="hidden" name="id" value={e.id} />
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Reverse
                        </button>
                      </form>
                    ) : null}
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

function EntryStatus({ status }: { status: JournalEntryRow['status'] }) {
  if (status === 'posted') return <span className="badge badge-success">Posted</span>;
  if (status === 'draft') return <span className="badge badge-warning">Draft</span>;
  return <span className="badge badge-neutral">Void</span>;
}
