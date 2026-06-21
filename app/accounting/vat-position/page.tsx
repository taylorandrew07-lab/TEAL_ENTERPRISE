import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';
import { vatPosition } from '@/modules/accounting/rates';
import { formatMoney } from '@/lib/format';

export const metadata = { title: 'VAT Position — TEAL Accounting' };

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default async function VatPositionPage() {
  await requireModule('accounting', 'private.view');
  const v = await vatPosition();

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow" style={{ color: 'var(--primary-strong)' }}>Accounting · Private</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>VAT Position</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 680 }}>
            Output VAT you owe the BIR vs input VAT you’ve paid and can claim back. In Trinidad the input
            (recoverable) VAT is slow to recover, so it’s tracked and aged here so you can see how much — and
            how old — is stuck.
          </p>
        </div>
        <span className="badge badge-brand" style={{ alignSelf: 'start' }}>Private</span>
      </div>

      {!v.configured ? (
        <div className="card" style={{ padding: 28, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>Set up your tax codes first</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            This view reads VAT from your tax codes’ collected (payable) and paid (recoverable) accounts.
            Add a VAT tax code with those accounts in <Link href={'/accounting/tax-codes' as Route}>Tax Codes</Link>,
            and the position fills in as you post.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
            <Stat label="Output VAT (payable to BIR)" value={formatMoney(v.payable, v.currency)} />
            <Stat label="Input VAT (recoverable, often stuck)" value={formatMoney(v.recoverable, v.currency)} accent />
            <Stat
              label={v.net >= 0 ? 'Net owed to BIR' : 'Net claimable from BIR'}
              value={formatMoney(Math.abs(v.net), v.currency)}
              badge={v.net >= 0 ? { text: 'Payable', cls: 'badge-warning' } : { text: 'Refund due', cls: 'badge-success' }}
            />
          </div>

          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Recoverable VAT by month incurred</h2>
          {v.recoverableByMonth.length === 0 ? (
            <div className="card" style={{ padding: 20, maxWidth: 620 }}>
              <p className="muted" style={{ margin: 0 }}>No recoverable VAT recorded yet.</p>
            </div>
          ) : (
            <div className="table-wrap" style={{ maxWidth: 520 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Month incurred</th>
                    <th className="num" style={{ width: 180 }}>Recoverable</th>
                  </tr>
                </thead>
                <tbody>
                  {v.recoverableByMonth.map((m) => (
                    <tr key={m.month}>
                      <td>{monthLabel(m.month)}</td>
                      <td className="num">{formatMoney(m.amount, v.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ fontWeight: 650 }}>Total recoverable</td>
                    <td className="num" style={{ fontWeight: 650 }}>{formatMoney(v.recoverable, v.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 16, maxWidth: 620 }}>
            For now this keeps the recoverable VAT on the books and shows its age. When you’re ready we can add a
            provision (write-down) against the portion you don’t expect to recover — just say the word.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, badge, accent }: { label: string; value: string; badge?: { text: string; cls: string }; accent?: boolean }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>{label}</div>
      <div className="num" style={{ fontSize: 'var(--text-xl)', fontWeight: 650, marginTop: 4, color: accent ? 'var(--primary-strong)' : 'var(--ink)' }}>{value}</div>
      {badge ? <span className={`badge ${badge.cls}`} style={{ marginTop: 8 }}>{badge.text}</span> : null}
    </div>
  );
}
