import { requireModule } from '@/core/session/guard';
import { listExchangeRates, listCurrencyCodes, addExchangeRate } from '@/modules/accounting/rates';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Exchange Rates — TEAL Accounting' };

export default async function ExchangeRatesPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'currency.manage');
  const [rates, currencies] = await Promise.all([listExchangeRates(), listCurrencyCodes()]);
  const today = new Date().toISOString().slice(0, 10);
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Setup</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Exchange Rates</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 660 }}>
            The official (bank) rates the books convert at. Enter a rate as: 1 unit of the “from” currency
            = this many of the “to” currency (e.g. 1 USD = 6.79 TTD).
          </p>
        </div>
      </div>

      {error ? <Banner>{error}</Banner> : null}

      <details className="card" open={rates.length === 0} style={{ padding: 0, maxWidth: 660, marginBottom: 22 }}>
        <summary style={{ padding: '14px 18px', cursor: 'pointer', fontWeight: 600, listStyle: 'none', userSelect: 'none' }}>
          + Add an exchange rate
        </summary>
        <form action={addExchangeRate} style={{ padding: '4px 18px 18px', display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
            <CurrencyField id="from_currency" label="From" currencies={currencies} def="USD" />
            <CurrencyField id="to_currency" label="To" currencies={currencies} def="TTD" />
            <div className="field">
              <label className="label" htmlFor="rate">Rate</label>
              <input id="rate" name="rate" className="input num" inputMode="decimal" placeholder="e.g. 6.79" required style={{ textAlign: 'right' }} />
            </div>
            <div className="field">
              <label className="label" htmlFor="rate_date">Date</label>
              <input id="rate_date" name="rate_date" className="input" type="date" defaultValue={today} required />
            </div>
          </div>
          <div><button type="submit" className="btn btn-primary">Add rate</button></div>
        </form>
      </details>

      {rates.length > 0 ? (
        <div className="table-wrap" style={{ maxWidth: 660 }}>
          <table className="table">
            <thead>
              <tr>
                <th className="date" style={{ width: 130 }}>Date</th>
                <th>Pair</th>
                <th className="num" style={{ width: 170 }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <td className="date">{formatDate(r.rate_date)}</td>
                  <td>{r.from_currency} → {r.to_currency}</td>
                  <td className="num">{r.rate.toLocaleString('en-TT', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function CurrencyField({ id, label, currencies, def }: { id: string; label: string; currencies: string[]; def: string }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} name={id} className="input" defaultValue={currencies.includes(def) ? def : ''}>
        <option value="">—</option>
        {currencies.map((c) => (<option key={c} value={c}>{c}</option>))}
      </select>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 660 }}>
      {children}
    </div>
  );
}
