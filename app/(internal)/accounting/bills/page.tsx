import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';
import { listBills, listSuppliers, type BillRow } from '@/modules/accounting/ap';
import { formatDate, formatMoney } from '@/lib/format';

export const metadata = { title: 'Bills — TEAL Accounting' };

export default async function BillsPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'bills.manage');
  const [bills, suppliers] = await Promise.all([listBills(), listSuppliers()]);
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Purchases</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Bills</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Supplier bills. Posting a bill debits your expenses and credits accounts payable.
          </p>
        </div>
        {suppliers.length > 0 ? (
          <Link href={'/accounting/bills/new' as Route} className="btn btn-primary">
            New bill
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
            maxWidth: 640,
          }}
        >
          {error}
        </div>
      ) : null}

      {suppliers.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>Add a supplier first</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            A bill always belongs to a supplier.{' '}
            <Link href={'/accounting/suppliers' as Route}>Add your first supplier</Link>, then come back to record
            a bill.
          </p>
          <Link href={'/accounting/suppliers' as Route} className="btn btn-primary">
            Go to suppliers
          </Link>
        </div>
      ) : bills.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No bills yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Record your first supplier bill — for example, rent or professional fees. Post it and the ledger and
            trial balance update instantly.
          </p>
          <Link href={'/accounting/bills/new' as Route} className="btn btn-primary">
            New bill
          </Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="date" style={{ width: 120 }}>
                  Bill date
                </th>
                <th style={{ width: 100 }}>No.</th>
                <th>Supplier</th>
                <th className="date" style={{ width: 120 }}>
                  Due
                </th>
                <th style={{ width: 100 }}>Status</th>
                <th className="num" style={{ width: 160 }}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td className="date">{formatDate(b.bill_date)}</td>
                  <td style={{ fontWeight: 600 }}>{b.bill_no ?? '—'}</td>
                  <td>{b.supplier_name}</td>
                  <td className="date">{b.due_date ? formatDate(b.due_date) : '—'}</td>
                  <td>
                    <BillStatus status={b.status} />
                  </td>
                  <td className="num">{formatMoney(b.total, b.currency_code)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BillStatus({ status }: { status: BillRow['status'] }) {
  if (status === 'paid') return <span className="badge badge-success">Paid</span>;
  if (status === 'partial') return <span className="badge badge-brand">Partial</span>;
  if (status === 'open') return <span className="badge badge-warning">Open</span>;
  if (status === 'void') return <span className="badge badge-neutral">Void</span>;
  return <span className="badge badge-neutral">Draft</span>;
}
