import Link from 'next/link';
import type { Route } from 'next';
import { requireModule } from '@/core/session/guard';
import {
  listCustomers,
  listIncomeAccounts,
  listReceivableAccounts,
  listTaxCodes,
  companyBaseCurrencyAR,
} from '@/modules/accounting/ar';
import { InvoiceForm } from './InvoiceForm';

export const metadata = { title: 'New invoice — TEAL Accounting' };

export default async function NewInvoicePage() {
  await requireModule('accounting', 'invoices.manage');
  const [customers, incomeAccounts, receivableAccounts, taxCodes, baseCurrency] = await Promise.all([
    listCustomers(),
    listIncomeAccounts(),
    listReceivableAccounts(),
    listTaxCodes(),
    companyBaseCurrencyAR(),
  ]);

  const missing: { label: string; href: string }[] = [];
  if (customers.length === 0) missing.push({ label: 'a customer', href: '/accounting/customers' });
  if (incomeAccounts.length === 0) missing.push({ label: 'an income account', href: '/accounting/accounts' });
  if (receivableAccounts.length === 0)
    missing.push({ label: 'a receivable (asset) account', href: '/accounting/accounts' });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href={'/accounting/invoices' as Route}>Invoices</Link>
          </div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>New invoice</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            Pick a customer, add income lines, then save a draft or post. Posting debits the receivable
            control account for the total and credits each income line.
          </p>
        </div>
      </div>

      {missing.length > 0 ? (
        <div className="card" style={{ padding: 24, maxWidth: 620 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 6px' }}>A little setup first</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            To raise an invoice you need {joinHuman(missing.map((m) => m.label))}.
          </p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {dedupeByHref(missing).map((m) => (
              <Link key={m.href} href={m.href as Route} className="btn btn-primary btn-sm">
                Set up {m.label.replace(/^an? /, '')}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <InvoiceForm
          customers={customers.map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            receivable_account_id: c.receivable_account_id,
          }))}
          incomeAccounts={incomeAccounts}
          receivableAccounts={receivableAccounts}
          taxCodes={taxCodes.map((t) => ({ id: t.id, code: t.code, name: t.name, rate: t.rate }))}
          baseCurrency={baseCurrency}
        />
      )}
    </div>
  );
}

function joinHuman(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function dedupeByHref(items: { label: string; href: string }[]): { label: string; href: string }[] {
  const seen = new Set<string>();
  return items.filter((m) => (seen.has(m.href) ? false : (seen.add(m.href), true)));
}
