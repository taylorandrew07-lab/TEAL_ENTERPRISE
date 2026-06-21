import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';
import {
  listOtherCompanies,
  accountsForCompany,
} from '@/modules/accounting/intercompany';
import { TransferForm } from './TransferForm';

export const metadata = { title: 'New inter-company transfer — TEAL Accounting' };

export default async function NewTransferPage() {
  const ctx = await requireModule('accounting', 'journals.manage');
  const fromCompanyId = ctx.activeCompanyId!;
  const fromCompanyName =
    ctx.companies.find((c) => c.id === fromCompanyId)?.name ?? 'This company';

  const [otherCompanies, fromAccounts] = await Promise.all([
    listOtherCompanies(),
    accountsForCompany(fromCompanyId),
  ]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href={'/accounting/transfers' as Route}>Inter-company Transfers</Link>
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>New transfer</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 680 }}>
            Posts two linked, balanced entries at once. In <strong>{fromCompanyName}</strong> we debit a
            Due-from (asset) account and credit the source account; in the destination company we debit
            the receiving account and credit a Due-to (liability) account.
          </p>
        </div>
      </div>

      {otherCompanies.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 640 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>You need a second company</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            A transfer moves value between two companies you belong to. Create or join another company in
            Administration first.
          </p>
          <Link href={'/admin/companies' as Route} className="btn btn-primary">
            Go to Administration
          </Link>
        </div>
      ) : (
        <TransferForm
          fromCompanyName={fromCompanyName}
          otherCompanies={otherCompanies}
          fromAccounts={fromAccounts}
        />
      )}
    </div>
  );
}
