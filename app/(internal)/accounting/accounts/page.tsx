import { requireModule } from '@/core/session/guard';
import { listAccounts, listAccountTypes, groupAccountsByCategory, type AccountCategory } from '@/modules/accounting/queries';
import { createAccount, seedStarterChart } from '@/modules/accounting/actions';

export const metadata = { title: 'Chart of Accounts — TEAL Accounting' };

const CATEGORY_LABEL: Record<AccountCategory, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
};

export default async function AccountsPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'accounts.manage');
  const [accounts, types] = await Promise.all([listAccounts(), listAccountTypes()]);
  const groups = groupAccountsByCategory(accounts);
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Chart of Accounts</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {accounts.length} account{accounts.length === 1 ? '' : 's'} · the backbone of the ledger.
          </p>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {accounts.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 620, marginBottom: 22 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>Start your chart of accounts</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Add a ready-made Trinidad &amp; Tobago starter chart (bank, receivables, payables, VAT/PAYE/NIS,
            revenue, expenses) — then tailor it. Or add accounts one at a time below.
          </p>
          <form action={seedStarterChart}>
            <button type="submit" className="btn btn-primary">
              Set up standard chart
            </button>
          </form>
        </div>
      ) : null}

      <NewAccountForm types={types} open={accounts.length === 0} />

      {groups.length > 0 ? (
        <div className="table-wrap" style={{ marginTop: 22 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Code</th>
                <th>Account</th>
                <th>Type</th>
                <th style={{ width: 110 }}>Normal</th>
                <th style={{ width: 100 }}>Status</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.category}>
                <tr>
                  <td colSpan={5} style={{ background: 'var(--surface-2)', fontWeight: 650, color: 'var(--ink-2)' }}>
                    {CATEGORY_LABEL[g.category]}
                  </td>
                </tr>
                {g.accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {a.code}
                    </td>
                    <td>
                      {a.name}
                      {a.is_bank_account ? <span className="badge badge-brand" style={{ marginLeft: 8 }}>Bank</span> : null}
                    </td>
                    <td className="muted">{a.account_type?.name}</td>
                    <td style={{ textTransform: 'capitalize' }}>{a.account_type?.normal_balance}</td>
                    <td>
                      {a.is_active ? (
                        <span className="badge badge-success">Active</span>
                      ) : (
                        <span className="badge badge-neutral">Inactive</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : null}
    </div>
  );
}

function NewAccountForm({ types, open }: { types: { id: string; name: string; category: string }[]; open: boolean }) {
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
        + Add an account
      </summary>
      <form action={createAccount} style={{ padding: '4px 18px 18px', display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="code">
              Code
            </label>
            <input id="code" name="code" className="input" inputMode="numeric" placeholder="e.g. 1000" required />
          </div>
          <div className="field">
            <label className="label" htmlFor="name">
              Account name
            </label>
            <input id="name" name="name" className="input" placeholder="e.g. Cash at Bank" required />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="account_type_id">
            Account type
          </label>
          <select id="account_type_id" name="account_type_id" className="input" required defaultValue="">
            <option value="" disabled>
              Choose a type…
            </option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.category})
              </option>
            ))}
          </select>
        </div>
        <label className="row" style={{ gap: 8, fontSize: 'var(--text-sm)' }}>
          <input type="checkbox" name="is_bank_account" /> This is a bank account
        </label>
        <div>
          <button type="submit" className="btn btn-primary">
            Add account
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
