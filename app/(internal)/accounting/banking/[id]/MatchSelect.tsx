'use client';

import { useRef } from 'react';
import { matchTransaction } from '@/modules/accounting/banking';
import type { MatchTarget } from '@/modules/accounting/banking-types';

export function MatchSelect({
  txnId,
  accountId,
  current,
  targets,
}: {
  txnId: string;
  accountId: string;
  current: string;
  targets: MatchTarget[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={matchTransaction}>
      <input type="hidden" name="txn_id" value={txnId} />
      <input type="hidden" name="account_id" value={accountId} />
      <select
        name="target"
        defaultValue={current}
        className="input"
        aria-label="Match transaction"
        style={{ padding: '5px 8px', fontSize: 'var(--text-xs)', minWidth: 170 }}
        onChange={() => ref.current?.requestSubmit()}
      >
        <option value="">— unmatched —</option>
        {targets.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </form>
  );
}
