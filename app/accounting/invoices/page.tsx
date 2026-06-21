import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';
import { listInvoices, type InvoiceStatus } from '@/modules/accounting/ar';
import { formatDate, formatMoney } from '@/lib/format';

export const metadata = { title: 'Sales Invoices — TEAL Accounting' };

export default async function InvoicesPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'invoices.manage');
  const invoices = await listInvoices();
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Receivables</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Sales Invoices</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Bill your customers. Posting an invoice debits receivables and credits income.
          </p>
        </div>
        <Link href={'/accounting/invoices/new' as Route} className="btn btn-primary">
          New invoice
        </Link>
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

      {invoices.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No invoices yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Raise your first sales invoice. Save it as a draft, or post it to update the ledger and the
            customer&apos;s receivable balance instantly.
          </p>
          <Link href={'/accounting/invoices/new' as Route} className="btn btn-primary">
            New invoice
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
                <th style={{ width: 110 }}>No.</th>
                <th>Customer</th>
                <th className="date" style={{ width: 120 }}>
                  Due
                </th>
                <th style={{ width: 100 }}>Status</th>
                <th className="num" style={{ width: 150 }}>
                  Total
                </th>
                <th className="num" style={{ width: 150 }}>
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="date">{formatDate(inv.invoice_date)}</td>
                  <td style={{ fontWeight: 600 }}>
                    <Link href={`/accounting/invoices/${inv.id}` as Route}>{inv.invoice_no ?? 'View'}</Link>
                  </td>
                  <td>{inv.customer_name}</td>
                  <td className="date">{formatDate(inv.due_date)}</td>
                  <td>
                    <InvoiceStatusBadge status={inv.status} />
                  </td>
                  <td className="num">{formatMoney(inv.total, inv.currency_code)}</td>
                  <td className="num">{inv.balance > 0 ? formatMoney(inv.balance, inv.currency_code) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const map: Record<InvoiceStatus, { cls: string; label: string }> = {
    draft: { cls: 'badge-warning', label: 'Draft' },
    open: { cls: 'badge-brand', label: 'Open' },
    partial: { cls: 'badge-brand', label: 'Partial' },
    paid: { cls: 'badge-success', label: 'Paid' },
    void: { cls: 'badge-neutral', label: 'Void' },
  };
  const { cls, label } = map[status] ?? map.draft;
  return <span className={`badge ${cls}`}>{label}</span>;
}
