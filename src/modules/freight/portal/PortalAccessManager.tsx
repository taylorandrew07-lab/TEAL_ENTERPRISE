// Staff UI for managing customer-portal access. Grant a contact's email a portal
// login (membership-free), revoke, or reset their password. Returned temp passwords
// are shown once. All writes go through the audited server actions in admin.ts.
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { grantPortalAccess, revokePortalAccess, resendPortalInvite } from './admin';

export interface ContactOption { id: string; name: string }
export interface AccessRow { id: string; customerName: string; email: string; status: string; createdAt: string }

export function PortalAccessManager({ contacts, rows }: { contacts: ContactOption[]; rows: AccessRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [handover, setHandover] = useState<{ email: string; tempPassword: string | null } | null>(null);
  const [form, setForm] = useState({ customerContactId: contacts[0]?.id ?? '', email: '', fullName: '' });

  function onGrant(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setHandover(null);
    startTransition(async () => {
      const res = await grantPortalAccess(form);
      if (!res.ok) { setError(res.error); return; }
      setHandover({ email: res.email, tempPassword: res.tempPassword });
      setForm({ customerContactId: contacts[0]?.id ?? '', email: '', fullName: '' });
      router.refresh();
    });
  }

  function onRevoke(id: string, who: string) {
    if (!confirm(`Revoke portal access for ${who}?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await revokePortalAccess({ clientAccessId: id });
      if (!res.ok) setError(res.error); else router.refresh();
    });
  }

  function onResend(id: string) {
    setError(null); setHandover(null);
    startTransition(async () => {
      const res = await resendPortalInvite({ clientAccessId: id });
      if (!res.ok) { setError(res.error); return; }
      setHandover({ email: res.email, tempPassword: res.tempPassword });
      router.refresh();
    });
  }

  return (
    <div>
      {error ? (
        <div role="alert" style={{ background: 'var(--danger-weak)', color: 'var(--danger)', border: '1px solid oklch(0.85 0.06 25)', padding: '9px 12px', borderRadius: 'var(--r)', fontSize: 'var(--text-sm)', marginBottom: 14 }}>{error}</div>
      ) : null}

      {handover ? (
        <div role="status" style={{ background: 'var(--success-weak)', color: 'var(--success)', border: '1px solid oklch(0.82 0.08 150)', padding: '10px 14px', borderRadius: 'var(--r)', fontSize: 'var(--text-sm)', marginBottom: 14 }}>
          {handover.tempPassword ? (
            <>
              <strong>{handover.email}</strong> can now sign in at <code>/portal</code>. Temporary password (shown once — hand it over securely):{' '}
              <code style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>{handover.tempPassword}</code>
            </>
          ) : (
            <><strong>{handover.email}</strong> already had an account — portal access is now active with their existing password.</>
          )}
        </div>
      ) : null}

      <div className="card" style={{ padding: 18, marginBottom: 22, maxWidth: 680 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 14px' }}>Give a customer portal access</h2>
        <form onSubmit={onGrant} style={{ display: 'grid', gap: 12 }}>
          <div className="field">
            <label className="label" htmlFor="pa-customer">Customer</label>
            <select id="pa-customer" className="input" value={form.customerContactId} onChange={(e) => setForm({ ...form, customerContactId: e.target.value })} required>
              {contacts.length === 0 ? <option value="">No contacts yet</option> : null}
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label className="label" htmlFor="pa-email">Their email</label>
              <input id="pa-email" type="email" className="input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="person@customer.com" />
            </div>
            <div className="field">
              <label className="label" htmlFor="pa-name">Full name</label>
              <input id="pa-name" className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Their name" />
            </div>
          </div>
          <div>
            <button type="submit" className="btn btn-primary" disabled={pending || contacts.length === 0}>
              {pending ? 'Working…' : 'Grant access'}
            </button>
          </div>
        </form>
      </div>

      <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Portal users <span className="muted num" style={{ fontWeight: 400, fontSize: 'var(--text-sm)' }}>· {rows.length}</span></h2>
      {rows.length === 0 ? (
        <div className="card" style={{ padding: 18 }}><p className="muted" style={{ margin: 0 }}>No customers have portal access yet.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Customer</th><th>Email</th><th style={{ width: 110 }}>Status</th><th style={{ width: 200 }} /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.customerName}</td>
                  <td className="muted">{r.email}</td>
                  <td><span className={`badge ${r.status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{r.status}</span></td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => onResend(r.id)}>Reset password</button>
                      {r.status === 'active' ? (
                        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => onRevoke(r.id, r.customerName)}>Revoke</button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
