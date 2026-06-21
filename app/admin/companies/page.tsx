import { redirect } from 'next/navigation';
import { requireAuth } from '@/core/session/guard';
import { can } from '@/core/session/types';
import { MONTHS } from '@/lib/format';
import {
  listCompanies,
  listCurrencies,
  createCompany,
} from '@/modules/admin/companies';

export const metadata = { title: 'Companies — TEAL Administration' };

function monthName(m: number): string {
  return MONTHS[m - 1] ?? '—';
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const ctx = await requireAuth();
  if (!ctx.isSuperAdmin && !can(ctx, 'company.manage')) redirect('/');

  const [companies, currencies] = await Promise.all([listCompanies(), listCurrencies()]);
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Administration</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Companies</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {companies.length} compan{companies.length === 1 ? 'y' : 'ies'} you can access. Create a new
            one to make it the active company.
          </p>
        </div>
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
            maxWidth: 600,
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="card" style={{ padding: 24, maxWidth: 600, marginBottom: 22 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 4px' }}>New company</h2>
        <p className="muted" style={{ margin: '0 0 16px', fontSize: 'var(--text-sm)' }}>
          You become its administrator, Accounting and Cargo Assurance are enabled, and it becomes
          your active company.
        </p>
        <form action={createCompany} style={{ display: 'grid', gap: 16 }}>
          <div className="field">
            <label className="label" htmlFor="name">
              Company name
            </label>
            <input
              id="name"
              name="name"
              className="input"
              placeholder="e.g. Taylor Engineering Ltd"
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="base_currency_code">
              Base currency
            </label>
            <select
              id="base_currency_code"
              name="base_currency_code"
              className="input"
              defaultValue="TTD"
              required
            >
              {currencies.length === 0 ? <option value="TTD">TTD</option> : null}
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="fiscal_year_start_month">
              Fiscal-year start month
            </label>
            <select
              id="fiscal_year_start_month"
              name="fiscal_year_start_month"
              className="input"
              defaultValue="1"
              required
            >
              {MONTHS.map((month, i) => (
                <option key={month} value={i + 1}>
                  {month}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="country_code">
              Country
            </label>
            <input
              id="country_code"
              name="country_code"
              className="input"
              defaultValue="TT"
              maxLength={2}
              placeholder="e.g. TT"
              style={{ textTransform: 'uppercase', maxWidth: 120 }}
              required
            />
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 'var(--text-sm)' }}>
              2-letter ISO country code (e.g. TT for Trinidad &amp; Tobago).
            </p>
          </div>

          <div>
            <button type="submit" className="btn btn-primary">
              Create company
            </button>
          </div>
        </form>
      </div>

      {companies.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 600 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No companies yet</h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
            You don&apos;t have access to any companies. Create one above to get started.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th style={{ width: 130 }}>Base currency</th>
                <th style={{ width: 100 }}>Country</th>
                <th style={{ width: 170 }}>Fiscal-year start</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    {c.name}
                    {c.id === ctx.activeCompanyId ? (
                      <span className="badge badge-brand" style={{ marginLeft: 8 }}>
                        Active
                      </span>
                    ) : null}
                  </td>
                  <td>{c.base_currency_code}</td>
                  <td>{c.country_code}</td>
                  <td>{monthName(c.fiscal_year_start_month)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
