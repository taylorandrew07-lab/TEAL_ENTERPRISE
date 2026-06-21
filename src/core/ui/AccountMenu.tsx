// AccountMenu — the top-right account control. Shows the signed-in user's name and
// role (both resolved dynamically from the platform context), and opens a dropdown
// with account settings, company switching (only when the user belongs to more than
// one company), and sign out. Replaces the static name/badge + header company select.
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { setActiveCompany } from '@/core/session/active-company';
import { signOut } from '@/core/session/auth-actions';
import type { SessionCompany } from '@/core/session/types';

export function AccountMenu({
  displayName,
  email,
  roleLabel,
  isSuperAdmin,
  companies,
  activeCompanyId,
}: {
  displayName: string;
  email: string;
  roleLabel: string | null;
  isSuperAdmin: boolean;
  companies: SessionCompany[];
  activeCompanyId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = (displayName || email || '?').trim().charAt(0).toUpperCase();
  const roleClass = isSuperAdmin ? 'badge-brand' : 'badge-neutral';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={ref}>
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="account-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="account-trigger-main hide-sm">
          <span className="account-trigger-name">{displayName}</span>
          {roleLabel ? (
            <span className={`badge ${roleClass} account-trigger-badge`}>{roleLabel}</span>
          ) : null}
        </span>
        <svg className="account-caret" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="account-pop" role="menu">
          <div className="account-pop-head">
            <div className="account-pop-name">{displayName}</div>
            <div className="account-pop-email">{email}</div>
            {roleLabel ? (
              <span className={`badge ${roleClass}`} style={{ marginTop: 8 }}>
                {roleLabel}
              </span>
            ) : null}
          </div>

          <Link href="/account" className="account-item" role="menuitem" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <circle cx="8" cy="6" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M3 13.2c.7-2 2.6-3.2 5-3.2s4.3 1.2 5 3.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Account settings
          </Link>

          {companies.length > 1 ? (
            <>
              <div className="account-divider" />
              <div className="account-section-label">Switch company</div>
              <form action={setActiveCompany}>
                {companies.map((c) => {
                  const active = c.id === activeCompanyId;
                  return (
                    <button
                      key={c.id}
                      type="submit"
                      name="companyId"
                      value={c.id}
                      className="account-item"
                      role="menuitem"
                      data-active={active}
                    >
                      <span className="account-item-tick" aria-hidden="true">
                        {active ? '✓' : ''}
                      </span>
                      {c.name}
                    </button>
                  );
                })}
              </form>
            </>
          ) : null}

          <div className="account-divider" />
          <form action={signOut}>
            <button type="submit" className="account-item" role="menuitem">
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M6 2H3v12h3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9.5 5l3 3-3 3M12 8H6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
