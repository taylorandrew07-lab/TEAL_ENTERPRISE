import { requireModule } from '@/core/session/guard';
import { MONTHS } from '@/lib/format';
import {
  getCompanySettings,
  listCurrencies,
  updateCompanySettings,
} from '@/modules/accounting/settings';

export const metadata = { title: 'Company Settings — TEAL Accounting' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string };
}) {
  await requireModule('accounting', 'company.manage');
  const [company, currencies] = await Promise.all([getCompanySettings(), listCurrencies()]);
  const error = searchParams?.error;
  const ok = searchParams?.ok;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Company Settings</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Your company profile and accounting defaults. The fiscal-year start drives how
            periods are generated.
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

      {ok && !error ? (
        <div
          role="status"
          className="card"
          style={{
            borderColor: 'oklch(0.85 0.06 150)',
            background: 'var(--success-weak)',
            color: 'var(--success)',
            padding: '9px 12px',
            fontSize: 'var(--text-sm)',
            marginBottom: 16,
            maxWidth: 600,
          }}
        >
          Settings saved.
        </div>
      ) : null}

      {!company ? (
        <div className="card" style={{ padding: 28, maxWidth: 600 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>No active company</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Select a company to edit its settings.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 24, maxWidth: 600 }}>
          <form action={updateCompanySettings} style={{ display: 'grid', gap: 16 }}>
            <div className="field">
              <label className="label" htmlFor="name">
                Company name
              </label>
              <input
                id="name"
                name="name"
                className="input"
                defaultValue={company.name}
                placeholder="Taylor Engineering Ltd"
                required
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="legal_name">
                Legal name
              </label>
              <input
                id="legal_name"
                name="legal_name"
                className="input"
                defaultValue={company.legal_name ?? ''}
                placeholder="Registered legal entity name (optional)"
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="fiscal_year_start_month">
                Fiscal-year start month
              </label>
              <select
                id="fiscal_year_start_month"
                name="fiscal_year_start_month"
                className="input"
                defaultValue={String(company.fiscal_year_start_month)}
                required
              >
                {MONTHS.map((month, i) => (
                  <option key={month} value={i + 1}>
                    {month}
                  </option>
                ))}
              </select>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 'var(--text-sm)' }}>
                Determines the first month of each fiscal year when generating accounting periods.
              </p>
            </div>

            <div className="field">
              <label className="label" htmlFor="base_currency_code">
                Base currency
              </label>
              <select
                id="base_currency_code"
                name="base_currency_code"
                className="input"
                defaultValue={company.base_currency_code}
                required
              >
                {currencies.length === 0 ? (
                  <option value={company.base_currency_code}>{company.base_currency_code}</option>
                ) : null}
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 'var(--text-sm)' }}>
                The reporting currency for this company. Existing postings are not changed.
              </p>
            </div>

            <div className="field">
              <label className="label" htmlFor="country_code">
                Country
              </label>
              <input
                id="country_code"
                name="country_code"
                className="input"
                defaultValue={company.country_code}
                maxLength={2}
                placeholder="TT"
                style={{ textTransform: 'uppercase', maxWidth: 120 }}
                required
              />
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 'var(--text-sm)' }}>
                2-letter ISO country code (e.g. TT for Trinidad &amp; Tobago).
              </p>
            </div>

            <div>
              <button type="submit" className="btn btn-primary">
                Save settings
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
