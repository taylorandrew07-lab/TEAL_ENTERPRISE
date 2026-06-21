import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';
import {
  listIntercompanyTransfers,
  listOtherCompanies,
} from '@/modules/accounting/intercompany';
import { formatDate, formatMoney } from '@/lib/format';

export const metadata = { title: 'Inter-company Transfers — TEAL Accounting' };

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  await requireModule('accounting', 'journals.manage');
  const [transfers, otherCompanies] = await Promise.all([
    listIntercompanyTransfers(),
    listOtherCompanies(),
  ]);
  const error = searchParams?.error;
  const canTransfer = otherCompanies.length > 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Group</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Inter-company Transfers</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 680 }}>
            Move value between two companies of the group as a single linked pair of balanced journal
            entries — a Due-from asset in the sender and a matching Due-to liability in the receiver.
          </p>
        </div>
        {canTransfer ? (
          <Link href={'/accounting/transfers/new' as Route} className="btn btn-primary">
            New transfer
          </Link>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="card"
          style={{
            borderColor: 'oklch(0.85 0.06 25)',
            background: 'var(--danger-weak)',
            color: 'var(--danger)',
            padding: '9px 12px',
            fontSize: 'var(--text-sm)',
            marginBottom: 16,
            maxWidth: 680,
          }}
        >
          {error}
        </div>
      ) : null}

      {!canTransfer ? (
        <div className="card" style={{ padding: 28, maxWidth: 640 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>You need a second company</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            An inter-company transfer posts into two companies at once, so you must belong to more than
            one. Create or join another company in Administration, then come back here to record a
            transfer between them.
          </p>
          <Link href={'/admin/companies' as Route} className="btn btn-primary">
            Go to Administration
          </Link>
        </div>
      ) : transfers.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 680 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No transfers yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Record your first inter-company transfer. It posts two balanced entries at once: in the
            sender we debit a <strong>Due-from</strong> (asset) account and credit the source account
            (e.g. its bank); in the receiver we debit the destination account (e.g. its bank) and
            credit a <strong>Due-to</strong> (liability) account. The two are linked so they can be
            traced and eliminated on consolidation. You must belong to both companies, and each must
            have an open period for the transfer date.
          </p>
          <Link href={'/accounting/transfers/new' as Route} className="btn btn-primary">
            New transfer
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="date" style={{ width: 120 }}>
                  Date
                </th>
                <th style={{ width: 80 }}>Flow</th>
                <th>From</th>
                <th>To</th>
                <th>Description</th>
                <th className="num" style={{ width: 170 }}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td className="date">{formatDate(t.transfer_date)}</td>
                  <td>
                    {t.direction === 'out' ? (
                      <span className="badge badge-warning">Out</span>
                    ) : (
                      <span className="badge badge-success">In</span>
                    )}
                  </td>
                  <td>{t.from_company_name}</td>
                  <td>{t.to_company_name}</td>
                  <td className="muted">{t.description ?? '—'}</td>
                  <td className="num">{formatMoney(t.amount, t.currency_code)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
