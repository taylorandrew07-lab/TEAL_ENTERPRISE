import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';
import { listSuppliers, listPayableAccounts, addSupplier } from '@/modules/accounting/ap';

export const metadata = { title: 'Suppliers — TEAL Accounting' };

export default async function SuppliersPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'suppliers.manage');
  const [suppliers, payableAccounts] = await Promise.all([listSuppliers(), listPayableAccounts()]);
  const accountById = new Map(payableAccounts.map((a) => [a.id, a]));
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Purchases</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Suppliers</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {suppliers.length} supplier{suppliers.length === 1 ? '' : 's'} · the people and companies you owe.
          </p>
        </div>
        <Link href={'/accounting/bills/new' as Route} className="btn btn-primary">
          New bill
        </Link>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <NewSupplierForm payableAccounts={payableAccounts} open={suppliers.length === 0} />

      {suppliers.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620, marginTop: 22 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No suppliers yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Add a supplier above to start recording bills. Each bill you post debits an expense and credits
            your accounts payable control account.
          </p>
        </div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 22 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Code</th>
                <th>Supplier</th>
                <th>Email</th>
                <th>Payable account</th>
                <th style={{ width: 100 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => {
                const acct = s.payable_account_id ? accountById.get(s.payable_account_id) : null;
                return (
                  <tr key={s.id}>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {s.code}
                    </td>
                    <td>{s.name}</td>
                    <td className="muted">{s.email ?? '—'}</td>
                    <td className="muted">{acct ? `${acct.code} · ${acct.name}` : '—'}</td>
                    <td>
                      {s.is_active ? (
                        <span className="badge badge-success">Active</span>
                      ) : (
                        <span className="badge badge-neutral">Inactive</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewSupplierForm({
  payableAccounts,
  open,
}: {
  payableAccounts: { id: string; code: string; name: string }[];
  open: boolean;
}) {
  return (
    <details open={open} className="card" style={{ padding: 0, maxWidth: 620 }}>
      <summary
        style={{
          padding: '14px 18px',
          cursor: 'pointer',
          fontWeight: 600,
          listStyle: 'none',
          userSelect: 'none',
        }}
      >
        + Add a supplier
      </summary>
      <form action={addSupplier} style={{ padding: '4px 18px 18px', display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="code">
              Code
            </label>
            <input id="code" name="code" className="input" placeholder="e.g. SUP-001" required />
          </div>
          <div className="field">
            <label className="label" htmlFor="name">
              Supplier name
            </label>
            <input id="name" name="name" className="input" placeholder="e.g. Acme Supplies Ltd" required />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="email">
            Email <span className="muted">(optional)</span>
          </label>
          <input id="email" name="email" type="email" className="input" placeholder="e.g. billing@acme.com" />
        </div>
        <div className="field">
          <label className="label" htmlFor="payable_account_id">
            Payable account <span className="muted">(optional)</span>
          </label>
          <select id="payable_account_id" name="payable_account_id" className="input" defaultValue="">
            <option value="">Use the bill&apos;s payable account</option>
            {payableAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <button type="submit" className="btn btn-primary">
            Add supplier
          </button>
        </div>
      </form>
    </details>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        background: 'var(--danger-weak)',
        border: '1px solid oklch(0.85 0.06 25)',
        color: 'var(--danger)',
        padding: '9px 12px',
        borderRadius: 'var(--r)',
        fontSize: 'var(--text-sm)',
        marginBottom: 16,
        maxWidth: 620,
      }}
    >
      {message}
    </div>
  );
}
