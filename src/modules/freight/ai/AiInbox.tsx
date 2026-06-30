// AI inbox — review queue for AI-proposed actions awaiting human approval, plus a
// recent-activity log. Approve/reject go through the audited server actions.
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveAiJob, rejectAiJob } from './approval';
import type { AiJobRow } from './queries';

const STATUS_BADGE: Record<string, string> = {
  awaiting_approval: 'badge-warning', done: 'badge-success', skipped: 'badge-neutral', failed: 'badge-danger', running: 'badge-brand', queued: 'badge-neutral',
};

export function AiInbox({ awaiting, recent }: { awaiting: AiJobRow[]; recent: AiJobRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(fn: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, id: string) {
    setError(null);
    const fd = new FormData(); fd.set('id', id);
    start(async () => { const r = await fn(fd); if (!r.ok) setError(r.error ?? 'Failed'); else router.refresh(); });
  }

  return (
    <div>
      {error ? <div role="alert" style={{ background: 'var(--danger-weak)', color: 'var(--danger)', border: '1px solid oklch(0.85 0.06 25)', padding: '9px 12px', borderRadius: 'var(--r)', fontSize: 'var(--text-sm)', marginBottom: 14 }}>{error}</div> : null}

      <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Awaiting approval <span className="muted num" style={{ fontWeight: 400, fontSize: 'var(--text-sm)' }}>· {awaiting.length}</span></h2>
      {awaiting.length === 0 ? (
        <div className="card" style={{ padding: 18, marginBottom: 24 }}><p className="muted" style={{ margin: 0 }}>Nothing waiting. AI-proposed actions will appear here for review before anything is sent or saved.</p></div>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginBottom: 24 }}>
          {awaiting.map((j) => (
            <div key={j.id} className="card" style={{ padding: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <strong>{j.job_type}</strong>
                <span className="muted num" style={{ fontSize: 'var(--text-sm)' }}>{j.model}</span>
              </div>
              {j.output?.text ? <p className="muted" style={{ margin: '6px 0', fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap' }}>{j.output.text}</p> : null}
              {j.tool_calls ? <pre style={{ background: 'var(--surface-2)', padding: 10, borderRadius: 8, fontSize: 'var(--text-xs)', overflow: 'auto' }}>{JSON.stringify(j.tool_calls, null, 2)}</pre> : null}
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => act(approveAiJob, j.id)}>Approve</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act(rejectAiJob, j.id)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Recent AI activity</h2>
      {recent.length === 0 ? (
        <div className="card" style={{ padding: 18 }}><p className="muted" style={{ margin: 0 }}>No AI jobs yet. AI is dormant until a provider key is added and a task is switched on in Settings → AI.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Task</th><th style={{ width: 130 }}>Status</th><th>Model</th><th>Note</th></tr></thead>
            <tbody>
              {recent.map((j) => (
                <tr key={j.id}>
                  <td style={{ fontWeight: 600 }}>{j.job_type}</td>
                  <td><span className={`badge ${STATUS_BADGE[j.status] ?? 'badge-neutral'}`}>{j.status.replace(/_/g, ' ')}</span></td>
                  <td className="muted">{j.model ?? '—'}</td>
                  <td className="muted" style={{ fontSize: 'var(--text-sm)' }}>{j.error ?? (j.output?.text ? j.output.text.slice(0, 80) : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
