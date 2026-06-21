import { ModuleEmptyState } from '@/core/ui';

export default function AccountingHome() {
  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', margin: '0 0 4px' }}>Accounting</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 24px' }}>
        Double-entry general ledger, receivables, payables, banking and reporting.
      </p>
      <ModuleEmptyState
        title="No accounting data yet"
        description="Once the database is connected and your company is set up, the dashboard will show real ledger figures. Begin by creating your chart of accounts and accounting periods."
        actions={[
          { label: 'Chart of Accounts', href: '/accounting/accounts' },
          { label: 'Periods', href: '/accounting/periods' },
        ]}
      />
    </div>
  );
}
