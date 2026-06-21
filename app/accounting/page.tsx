import { ModuleEmptyState } from '@/core/ui';

export default function AccountingHome() {
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Accounting</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Dashboard</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Double-entry general ledger, receivables, payables, banking and reporting.
          </p>
        </div>
      </div>
      <ModuleEmptyState
        title="Set up your books"
        description="Your company is connected. Begin by creating the chart of accounts and opening an accounting period — then journals, invoices and reports light up with real figures."
        actions={[
          { label: 'Chart of Accounts', href: '/accounting/accounts' },
          { label: 'Periods', href: '/accounting/periods', primary: false },
        ]}
      />
    </div>
  );
}
