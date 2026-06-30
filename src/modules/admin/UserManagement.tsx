// User Management — per-company member access. A member list where each person's
// permissions are individual checkboxes (grouped by area), with role templates as
// one-click presets, an invite form (returns a temporary password to hand over),
// and remove-access. Super-admin and self rows are protected (read-only). All writes
// go through audited server actions; the database RLS + escalation guard are the
// backstop, so this UI can never grant more than the actor holds.
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setMemberGrant, applyTemplate, inviteUser, removeMember } from './users';
import type { CompanyMember } from './users-types';

interface PermGroup {
  category: string;
  label: string;
  perms: { key: string; name: string; description: string }[];
}
interface Template {
  key: string;
  name: string;
}

export function UserManagement({
  companyName,
  members,
  groups,
  templates,
}: {
  companyName: string;
  members: CompanyMember[];
  groups: PermGroup[];
  templates: Template[];
}) {
  const router = useRouter();
  const [grants, setGrants] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(members.map((m) => [m.membershipId, new Set(m.grantedKeys)])),
  );
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState({ email: '', fullName: '', roleKey: templates[0]?.key ?? '' });
  const [inviteResult, setInviteResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const editable = (m: CompanyMember) => !m.isSuperAdmin && !m.isSelf;

  function toggle(m: CompanyMember, key: string) {
    if (!editable(m) || pending) return;
    setError(null);
    const has = grants[m.membershipId]?.has(key);
    // optimistic
    setGrants((g) => {
      const next = new Set(g[m.membershipId]);
      if (has) next.delete(key);
      else next.add(key);
      return { ...g, [m.membershipId]: next };
    });
    setBusyKey(m.membershipId + key);
    startTransition(async () => {
      const res = await setMemberGrant({ membershipId: m.membershipId, permissionKey: key, granted: !has });
      setBusyKey(null);
      if (!res.ok) {
        // revert
        setGrants((g) => {
          const next = new Set(g[m.membershipId]);
          if (has) next.add(key);
          else next.delete(key);
          return { ...g, [m.membershipId]: next };
        });
        setError(res.error);
      }
    });
  }

  function onTemplate(m: CompanyMember, roleKey: string) {
    if (!editable(m) || !roleKey) return;
    setError(null);
    setBusyKey(m.membershipId);
    startTransition(async () => {
      const res = await applyTemplate({ membershipId: m.membershipId, roleKey });
      setBusyKey(null);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function onRemove(m: CompanyMember) {
    if (!editable(m)) return;
    if (!confirm(`Remove ${m.fullName ?? m.email}'s access to ${companyName}?`)) return;
    setError(null);
    setBusyKey(m.membershipId);
    startTransition(async () => {
      const res = await removeMember({ membershipId: m.membershipId });
      setBusyKey(null);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInviteResult(null);
    startTransition(async () => {
      const res = await inviteUser(invite);
      if (!res.ok) setError(res.error);
      else {
        setInviteResult({ email: res.email, tempPassword: res.tempPassword });
        setInvite({ email: '', fullName: '', roleKey: templates[0]?.key ?? '' });
        router.refresh();
      }
    });
  }

  const grantedCount = (m: CompanyMember) => grants[m.membershipId]?.size ?? 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Administration</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Users &amp; Access</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {members.length} member{members.length === 1 ? '' : 's'} of <strong>{companyName}</strong>. Tick exactly what each person can do.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowInvite((v) => !v)}>
          {showInvite ? 'Close' : 'Invite a user'}
        </button>
      </div>

      {error ? (
        <div role="alert" style={bannerStyle('danger')}>
          {error}
        </div>
      ) : null}

      {inviteResult ? (
        <div role="status" style={bannerStyle('success')}>
          <strong>{inviteResult.email}</strong> can now sign in. Temporary password (shown once — hand it over securely):{' '}
          <code style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
            {inviteResult.tempPassword}
          </code>
          . They should change it after signing in.
        </div>
      ) : null}

      {showInvite ? (
        <div className="card" style={{ padding: 22, marginBottom: 22, maxWidth: 680 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 14px' }}>Invite a user to {companyName}</h2>
          <form onSubmit={onInvite} style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label className="label" htmlFor="inv-email">Email</label>
                <input id="inv-email" className="input" type="email" required value={invite.email}
                  onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="e.g. person@company.com" />
              </div>
              <div className="field">
                <label className="label" htmlFor="inv-name">Full name</label>
                <input id="inv-name" className="input" value={invite.fullName}
                  onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} placeholder="Their name" />
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="inv-role">Start from template</label>
              <select id="inv-role" className="input" value={invite.roleKey}
                onChange={(e) => setInvite({ ...invite, roleKey: e.target.value })}>
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>{t.name}</option>
                ))}
              </select>
              <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '6px 0 0' }}>
                Pre-ticks a sensible set of permissions; you can fine-tune their checkboxes afterwards.
              </p>
            </div>
            <div>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? 'Creating…' : 'Create user'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 16 }}>
        {members.map((m) => {
          const ed = editable(m);
          const busy = busyKey === m.membershipId;
          return (
            <div key={m.membershipId} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '16px 20px', borderBottom: ed ? '1px solid var(--border)' : 'none' }}>
                <div className="row" style={{ gap: 12, minWidth: 0 }}>
                  <span className="account-avatar" aria-hidden="true" style={{ width: 36, height: 36, fontSize: 15 }}>
                    {(m.fullName ?? m.email ?? '?').charAt(0).toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {m.fullName ?? m.email}
                      {m.isSelf ? <span className="muted" style={{ fontWeight: 400 }}> · you</span> : null}
                    </div>
                    <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{m.email}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {m.isSuperAdmin ? (
                    <span className="badge badge-brand">Super Admin · protected</span>
                  ) : (
                    <span className="badge badge-neutral">{grantedCount(m)} permission{grantedCount(m) === 1 ? '' : 's'}</span>
                  )}
                  {ed ? (
                    <>
                      <select className="input" style={{ width: 'auto', padding: '6px 10px', fontSize: 'var(--text-sm)' }}
                        defaultValue="" disabled={busy}
                        onChange={(e) => { const v = e.target.value; e.currentTarget.value = ''; if (v) onTemplate(m, v); }}>
                        <option value="" disabled>Apply template…</option>
                        {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                      </select>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onRemove(m)}>
                        Remove
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {ed ? (
                <div style={{ padding: '16px 20px', opacity: busy ? 0.6 : 1, transition: 'opacity var(--dur-fast) var(--ease-out)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '18px 24px' }}>
                    {groups.map((g) => (
                      <div key={g.category}>
                        <div className="eyebrow" style={{ marginBottom: 8 }}>{g.label}</div>
                        <div style={{ display: 'grid', gap: 7 }}>
                          {g.perms.map((p) => {
                            const checked = grants[m.membershipId]?.has(p.key) ?? false;
                            return (
                              <label key={p.key} className="row" style={{ gap: 9, fontSize: 'var(--text-sm)', cursor: busy ? 'default' : 'pointer' }} title={p.description}>
                                <input type="checkbox" checked={checked} disabled={busy} onChange={() => toggle(m, p.key)} />
                                <span>{p.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ padding: '0 20px 16px' }}>
                  <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
                    {m.isSuperAdmin
                      ? 'Super admins have full platform access and are protected — their permissions can’t be edited here.'
                      : 'This is your own account; manage your access from another admin account.'}
                  </p>
                </div>
              )}
            </div>
          );
        })}

        {members.length === 0 ? (
          <div className="card" style={{ padding: 28, maxWidth: 620 }}>
            <p className="muted" style={{ margin: 0 }}>No members yet. Invite someone to get started.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function bannerStyle(kind: 'danger' | 'success'): React.CSSProperties {
  const danger = kind === 'danger';
  return {
    background: danger ? 'var(--danger-weak)' : 'var(--success-weak)',
    border: `1px solid ${danger ? 'oklch(0.85 0.06 25)' : 'oklch(0.82 0.08 150)'}`,
    color: danger ? 'var(--danger)' : 'var(--success)',
    padding: '10px 14px',
    borderRadius: 'var(--r)',
    fontSize: 'var(--text-sm)',
    marginBottom: 16,
  };
}
