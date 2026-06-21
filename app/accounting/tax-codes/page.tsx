import { requireModule } from '@/core/session/guard';
import { listTaxCodes, listLiabilityAccounts, addTaxCode } from '@/modules/accounting/ar';

export const metadata = { title: 'Tax Codes — TEAL Accounting' };

const round2 = (n: number) => Math.round(n * 100) / 100;

export default async function TaxCodesPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireModule('accounting', 'tax.manage');
  const [taxCodes, liabilityAccounts] = await Promise.all([listTaxCodes(), listLiabilityAccounts()]);
  const error = searchParams?.error;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting · Setup</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Tax Codes</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            Define the taxes you charge (e.g. VAT 12.5%). Each posts its collected amount to a liability
            account, so output tax shows on the balance sheet — never hard-coded.
          </p>
        </div>
      </div>

      {error ? (
        <div role="alert" className="card" style={{ borderColor: 'oklch(0.85 0.06 25)', background: 'var(--danger-weak)', color: 'var(--danger)', padding: '9px 12px', fontSize: 'var(--text-sm)', marginBottom: 16, maxWidth: 620 }}>
          {error}
        </div>
      ) : null}

      <details className="card" open={taxCodes.length === 0} style={{ padding: 0, maxWidth: 620, marginBottom: 22 }}>
        <summary style={{ padding: '14px 18px', cursor: 'pointer', fontWeight: 600, listStyle: 'none', userSelect: 'none' }}>
          + Add a tax code
        </summary>
        <form action={addTaxCode} style={{ padding: '4px 18px 18px', display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="code">Code</label>
              <input id="code" name="code" className="input" placeholder="e.g. VAT" required />
            </div>
            <div className="field">
              <label className="label" htmlFor="name">Name</label>
              <input id="name" name="name" className="input" placeholder="e.g. VAT 12.5%" required />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="rate">Rate (%)</label>
              <input id="rate" name="rate" className="input num" inputMode="decimal" placeholder="e.g. 12.5" required style={{ textAlign: 'right' }} />
            </div>
            <div className="field">
              <label className="label" htmlFor="collected_account_id">Collected (VAT payable) account</label>
              <select id="collected_account_id" name="collected_account_id" className="input" defaultValue="">
                <option value="">— choose a liability account —</option>
                {liabilityAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
              </select>
            </div>
          </div>
          {liabilityAccounts.length === 0 ? (
            <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
              Tip: add a “VAT Payable” liability account in the{' '}
              <a href="/accounting/accounts">Chart of Accounts</a> first, then pick it here so tax can post.
            </p>
          ) : null}
          <div>
            <button type="submit" className="btn btn-primary">Add tax code</button>
          </div>
        </form>
      </details>

      {taxCodes.length > 0 ? (
        <div className="table-wrap" style={{ maxWidth: 720 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Code</th>
                <th>Name</th>
                <th className="num" style={{ width: 100 }}>Rate</th>
                <th style={{ width: 90 }}>Posts?</th>
              </tr>
            </thead>
            <tbody>
              {taxCodes.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.code}</td>
                  <td>{t.name}</td>
                  <td className="num">{round2(t.rate * 100)}%</td>
                  <td>
                    {t.collected_account_id ? (
                      <span className="badge badge-success">Ready</span>
                    ) : (
                      <span className="badge badge-warning">No account</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
