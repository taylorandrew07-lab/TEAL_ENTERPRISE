// Company switcher — re-scopes the whole platform to the selected company.
// Client component; submits to the setActiveCompany server action.
'use client';

import { useRef } from 'react';
import { setActiveCompany } from '@/core/session/active-company';
import type { SessionCompany } from '@/core/session/types';

export function CompanySwitcher({
  companies,
  activeCompanyId,
}: {
  companies: SessionCompany[];
  activeCompanyId: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  if (companies.length === 0) return null;

  return (
    <form ref={formRef} action={setActiveCompany}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Company</span>
        <select
          name="companyId"
          defaultValue={activeCompanyId ?? undefined}
          onChange={() => formRef.current?.requestSubmit()}
          disabled={companies.length === 1}
          style={{
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            background: '#fff',
            color: 'var(--ink)',
            fontSize: 14,
            maxWidth: 240,
          }}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
