import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { listPostableAccounts, companyBaseCurrency } from '@/modules/accounting/queries';
import { JournalForm } from '../JournalForm';

export const metadata = { title: 'New journal entry — TEAL Accounting' };

export default async function NewJournalPage() {
  await requireModule('accounting', 'journals.manage');
  const [accounts, baseCurrency] = await Promise.all([listPostableAccounts(), companyBaseCurrency()]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/accounting/journals">Journals</Link>
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>New journal entry</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            Enter balanced debits and credits, then post. Posting is final — corrections are made with a
            reversing entry, never an edit.
          </p>
        </div>
      </div>

      {accounts.length < 2 ? (
        <div className="card" style={{ padding: 24, maxWidth: 620 }}>
          <p style={{ marginTop: 0 }}>
            You need at least two accounts to post a journal. First{' '}
            <Link href="/accounting/accounts">set up your chart of accounts</Link>.
          </p>
        </div>
      ) : (
        <JournalForm accounts={accounts} baseCurrency={baseCurrency} />
      )}
    </div>
  );
}
