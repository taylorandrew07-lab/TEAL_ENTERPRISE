import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';
import {
  listSuppliers,
  listExpenseAccounts,
  listPayableAccounts,
  companyBaseCurrencyAP,
} from '@/modules/accounting/ap';
import { BillForm } from './BillForm';

export const metadata = { title: 'New bill — TEAL Accounting' };

export default async function NewBillPage() {
  await requireModule('accounting', 'bills.manage');
  const [suppliers, expenseAccounts, payableAccounts, baseCurrency] = await Promise.all([
    listSuppliers(),
    listExpenseAccounts(),
    listPayableAccounts(),
    companyBaseCurrencyAP(),
  ]);

  const ready = suppliers.length > 0 && expenseAccounts.length > 0 && payableAccounts.length > 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href={'/accounting/bills' as Route}>Bills</Link>
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>New bill</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            Record a supplier bill. Posting debits each expense line and credits accounts payable. Posting is
            final — corrections are made with a reversing entry.
          </p>
        </div>
      </div>

      {!ready ? (
        <div className="card" style={{ padding: 24, maxWidth: 620 }}>
          <p style={{ marginTop: 0 }}>To record a bill you need a few things in place first:</p>
          <ul className="muted" style={{ margin: '0 0 4px', paddingLeft: 18, lineHeight: 1.8 }}>
            {suppliers.length === 0 ? (
              <li>
                At least one <Link href={'/accounting/suppliers' as Route}>supplier</Link>.
              </li>
            ) : null}
            {expenseAccounts.length === 0 ? (
              <li>
                At least one expense account in your{' '}
                <Link href="/accounting/accounts">chart of accounts</Link>.
              </li>
            ) : null}
            {payableAccounts.length === 0 ? (
              <li>
                A payable (liability) account such as Accounts Payable in your{' '}
                <Link href="/accounting/accounts">chart of accounts</Link>.
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <BillForm
          suppliers={suppliers.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            payable_account_id: s.payable_account_id,
          }))}
          expenseAccounts={expenseAccounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
          payableAccounts={payableAccounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
          baseCurrency={baseCurrency}
        />
      )}
    </div>
  );
}
