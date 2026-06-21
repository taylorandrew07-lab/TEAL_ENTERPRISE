import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';
import { listCustomers, listReceivableAccounts, addCustomer } from '@/modules/accounting/ar';

export const metadata = { title: 'Customers — TEAL Accounting' };

export default async function CustomersPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'customers.manage');
  const [customers, receivables] = await Promise.all([listCustomers(), listReceivableAccounts()]);
  const receivableById = new Map(receivables.map((a) => [a.id, a]));
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Receivables</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Customers</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {customers.length} customer{customers.length === 1 ? '' : 's'} · the people you invoice.
          </p>
        </div>
        <Link href={'/accounting/invoices' as Route} className="btn btn-ghost">
          Invoices
        </Link>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {receivables.length === 0 ? (
        <div className="card" style={{ padding: 24, maxWidth: 620, marginBottom: 22 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No receivable account yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            A customer&apos;s balance is tracked against an Accounts Receivable (asset) control account.
            First <Link href="/accounting/accounts">set up your chart of accounts</Link>, then add customers.
          </p>
        </div>
      ) : null}

      <NewCustomerForm receivables={receivables} open={customers.length === 0 && receivables.length > 0} />

      {customers.length > 0 ? (
        <div className="table-wrap" style={{ marginTop: 22 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Code</th>
                <th>Customer</th>
                <th>Email</th>
                <th>Receivable account</th>
                <th style={{ width: 90 }}>Currency</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const ar = c.receivable_account_id ? receivableById.get(c.receivable_account_id) : null;
                return (
                  <tr key={c.id}>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {c.code}
                    </td>
                    <td>{c.name}</td>
                    <td className="muted">{c.email ?? '—'}</td>
                    <td className="muted">{ar ? `${ar.code} · ${ar.name}` : '—'}</td>
                    <td>{c.currency_code ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function NewCustomerForm({
  receivables,
  open,
}: {
  receivables: { id: string; code: string; name: string }[];
  open: boolean;
}) {
  if (receivables.length === 0) return null;
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
        + Add a customer
      </summary>
      <form action={addCustomer} style={{ padding: '4px 18px 18px', display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="code">
              Code
            </label>
            <input id="code" name="code" className="input" placeholder="C-001" required />
          </div>
          <div className="field">
            <label className="label" htmlFor="name">
              Customer name
            </label>
            <input id="name" name="name" className="input" placeholder="Atlantic Shipping Ltd" required />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" className="input" type="email" placeholder="accounts@example.com" />
        </div>
        <div className="field">
          <label className="label" htmlFor="receivable_account_id">
            Receivable account
          </label>
          <select id="receivable_account_id" name="receivable_account_id" className="input" defaultValue="">
            <option value="">No control account</option>
            {receivables.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <button type="submit" className="btn btn-primary">
            Add customer
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
