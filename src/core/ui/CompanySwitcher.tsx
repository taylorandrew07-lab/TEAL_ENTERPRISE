// Company switcher — re-scopes the platform to the selected company. Submits to the
// setActiveCompany server action on change.
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
      <select
        name="companyId"
        aria-label="Active company"
        defaultValue={activeCompanyId ?? undefined}
        onChange={() => formRef.current?.requestSubmit()}
        disabled={companies.length === 1}
        className="input"
        style={{
          width: 'auto',
          maxWidth: 230,
          padding: '7px 10px',
          fontSize: 'var(--text-sm)',
          fontWeight: 550,
          cursor: companies.length === 1 ? 'default' : 'pointer',
        }}
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </form>
  );
}
