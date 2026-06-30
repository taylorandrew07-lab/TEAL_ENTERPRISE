import { requireModule } from '@/core/session/guard';
import { listParallelRates, addParallelRate, deleteParallelRate } from '@/modules/accounting/rates';
import { listCurrencyCodes } from '@/modules/accounting/context';
import { formatDate } from '@/lib/format';
import { DeleteButton } from '@/core/ui/DeleteButton';

export const metadata = { title: 'Parallel FX Rates — TEAL Accounting' };

const fmt = (n: number, d = 4) => n.toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: d });

export default async function ParallelRatesPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'private.view');
  const [rates, currencies] = await Promise.all([listParallelRates(), listCurrencyCodes()]);
  const today = new Date().toISOString().slice(0, 10);
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow" style={{ color: 'var(--primary-strong)' }}>Accounting · Private</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Parallel FX Rates</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 680 }}>
            Private to people with the “View private accounting” permission. Record the real (parallel-market)
            rate you transact at against the official bank rate, so the spread is visible — the basis for the
            periodic correction to the books.
          </p>
        </div>
        <span className="badge badge-brand" style={{ alignSelf: 'start' }}>Private</span>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 660 }}>
          {error}
        </div>
      ) : null}

      <details className="card" open={rates.length === 0} style={{ padding: 0, maxWidth: 760, marginBottom: 22 }}>
        <summary style={{ padding: '14px 18px', cursor: 'pointer', fontWeight: 600, listStyle: 'none', userSelect: 'none' }}>
          + Record a parallel rate
        </summary>
        <form action={addParallelRate} style={{ padding: '4px 18px 18px', display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
            <Cur id="from_currency" label="From" currencies={currencies} def="USD" />
            <Cur id="to_currency" label="To" currencies={currencies} def="TTD" />
            <div className="field">
              <label className="label" htmlFor="official_rate">Official (bank)</label>
              <input id="official_rate" name="official_rate" className="input num" inputMode="decimal" placeholder="e.g. 6.79" required style={{ textAlign: 'right' }} />
            </div>
            <div className="field">
              <label className="label" htmlFor="parallel_rate">Parallel (real)</label>
              <input id="parallel_rate" name="parallel_rate" className="input num" inputMode="decimal" placeholder="e.g. 7.50" required style={{ textAlign: 'right' }} />
            </div>
            <div className="field">
              <label className="label" htmlFor="rate_date">Date</label>
              <input id="rate_date" name="rate_date" className="input" type="date" defaultValue={today} required />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="note">Note</label>
            <input id="note" name="note" className="input" placeholder="optional — e.g. broker, context" />
          </div>
          <div><button type="submit" className="btn btn-primary">Record rate</button></div>
        </form>
      </details>

      {rates.length > 0 ? (
        <div className="table-wrap" style={{ maxWidth: 820 }}>
          <table className="table">
            <thead>
              <tr>
                <th className="date" style={{ width: 120 }}>Date</th>
                <th>Pair</th>
                <th className="num">Official</th>
                <th className="num">Parallel</th>
                <th className="num">Spread</th>
                <th className="num">%</th>
                <th>Note</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <td className="date">{formatDate(r.rate_date)}</td>
                  <td>{r.from_currency} → {r.to_currency}</td>
                  <td className="num">{fmt(r.official_rate)}</td>
                  <td className="num">{fmt(r.parallel_rate)}</td>
                  <td className="num">{fmt(r.spread)}</td>
                  <td className="num" style={{ color: r.spread_pct > 0 ? 'var(--danger)' : 'var(--ink-2)', fontWeight: 600 }}>
                    {r.spread_pct > 0 ? '+' : ''}{r.spread_pct.toFixed(1)}%
                  </td>
                  <td className="muted">{r.note ?? '—'}</td>
                  <td><DeleteButton action={deleteParallelRate} fields={{ id: r.id }} confirm="Delete this parallel rate?" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Cur({ id, label, currencies, def }: { id: string; label: string; currencies: string[]; def: string }) {
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
