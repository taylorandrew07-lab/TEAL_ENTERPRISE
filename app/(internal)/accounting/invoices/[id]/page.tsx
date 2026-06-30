import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { requireModule } from '@/core/session/guard';
import { getInvoiceDetail, listBankAccounts, type InvoiceStatus } from '@/modules/accounting/ar';
import { formatDate, formatMoney } from '@/lib/format';
import { PaymentForm } from './PaymentForm';

export const metadata = { title: 'Invoice — TEAL Accounting' };

const STATUS: Record<InvoiceStatus, { cls: string; label: string }> = {
  draft: { cls: 'badge-warning', label: 'Draft' },
  open: { cls: 'badge-brand', label: 'Open' },
  partial: { cls: 'badge-brand', label: 'Partial' },
  paid: { cls: 'badge-success', label: 'Paid' },
  void: { cls: 'badge-neutral', label: 'Void' },
};

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  await requireModule('accounting', 'invoices.manage');
  const [inv, bankAccounts] = await Promise.all([getInvoiceDetail(params.id), listBankAccounts()]);
  if (!inv) notFound();

  const s = STATUS[inv.status] ?? STATUS.draft;
  const canPay = (inv.status === 'open' || inv.status === 'partial') && inv.balance > 0;

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href={'/accounting/invoices' as Route}>Invoices</Link>
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>
            Invoice {inv.invoice_no ?? '(draft)'}
          </h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {inv.customer_name} · {formatDate(inv.invoice_date)}
            {inv.due_date ? ` · due ${formatDate(inv.due_date)}` : ''}
          </p>
        </div>
        <span className={`badge ${s.cls}`} style={{ alignSelf: 'start' }}>{s.label}</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Account</th>
                <th style={{ width: 80 }}>Tax</th>
                <th className="num" style={{ width: 150 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.description ?? <span className="muted">—</span>}</td>
                  <td className="muted">{l.account_name ?? '—'}</td>
                  <td>{l.tax_code ?? <span className="muted">—</span>}</td>
                  <td className="num">{formatMoney(l.amount, inv.currency_code)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="num muted">Subtotal</td>
                <td className="num">{formatMoney(inv.subtotal, inv.currency_code)}</td>
              </tr>
              {inv.tax_total > 0 ? (
                <tr>
                  <td colSpan={3} className="num muted">Tax</td>
                  <td className="num">{formatMoney(inv.tax_total, inv.currency_code)}</td>
                </tr>
              ) : null}
              <tr>
                <td colSpan={3} className="num" style={{ fontWeight: 650 }}>Total</td>
                <td className="num" style={{ fontWeight: 650 }}>{formatMoney(inv.total, inv.currency_code)}</td>
              </tr>
              {inv.amount_paid > 0 ? (
                <>
                  <tr>
                    <td colSpan={3} className="num muted">Paid</td>
                    <td className="num">{formatMoney(inv.amount_paid, inv.currency_code)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="num" style={{ fontWeight: 650 }}>Balance</td>
                    <td className="num" style={{ fontWeight: 650 }}>{formatMoney(inv.balance, inv.currency_code)}</td>
                  </tr>
                </>
              ) : null}
            </tfoot>
          </table>
        </div>
      </div>

      {canPay ? (
        <div className="card" style={{ padding: 20, marginBottom: 18 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 14px' }}>Record a payment</h2>
          <PaymentForm invoiceId={inv.id} balance={inv.balance} currency={inv.currency_code} bankAccounts={bankAccounts} />
        </div>
      ) : null}

      {inv.payments.length > 0 ? (
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Payments</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="date" style={{ width: 130 }}>Date</th>
                  <th style={{ width: 120 }}>Receipt</th>
                  <th>Reference</th>
                  <th className="num" style={{ width: 150 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="date">{formatDate(p.payment_date)}</td>
                    <td style={{ fontWeight: 600 }}>{p.payment_no ?? '—'}</td>
                    <td>{p.reference ?? <span className="muted">—</span>}</td>
                    <td className="num">{formatMoney(p.amount, inv.currency_code)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
