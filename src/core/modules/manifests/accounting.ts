// =============================================================================
// TEAL Enterprise — Accounting module manifest (module #1)
// -----------------------------------------------------------------------------
// Declarative description consumed by the platform core. Permission keys mirror
// supabase/seed/seed.sql (core.permissions). See docs/platform-module-framework.md.
// =============================================================================
import type { ModuleManifest } from '../types';

export const accountingManifest: ModuleManifest = {
  key: 'accounting',
  name: 'Accounting',
  tagline: 'Double-entry general ledger, AR, AP, banking and reporting.',
  description:
    'Production-grade, multi-company double-entry accounting for the Taylor group: chart of ' +
    'accounts, journals, receivables, payables, banking, multi-currency, tax, and reporting.',
  route: '/accounting',
  schema: 'accounting',
  status: 'live',
  icon: 'ledger',
  enabledByDefault: true,
  navigation: [
    { key: 'dashboard', label: 'Dashboard', path: '', icon: 'gauge', requires: 'reports.view' },
    { key: 'accounts', label: 'Chart of Accounts', path: 'accounts', icon: 'list-tree', requires: 'accounts.manage', group: 'Ledger' },
    { key: 'journals', label: 'Journal Entries', path: 'journals', icon: 'book', requires: 'journals.manage', group: 'Ledger' },
    { key: 'periods', label: 'Periods', path: 'periods', icon: 'calendar', requires: 'periods.manage', group: 'Ledger' },
    { key: 'transfers', label: 'Inter-company Transfers', path: 'transfers', icon: 'arrow-left-right', requires: 'journals.manage', group: 'Ledger' },
    { key: 'customers', label: 'Customers', path: 'customers', icon: 'users', requires: 'customers.manage', group: 'Receivables' },
    { key: 'invoices', label: 'Invoices', path: 'invoices', icon: 'file-text', requires: 'invoices.manage', group: 'Receivables' },
    { key: 'suppliers', label: 'Suppliers', path: 'suppliers', icon: 'truck', requires: 'suppliers.manage', group: 'Payables' },
    { key: 'bills', label: 'Bills', path: 'bills', icon: 'receipt', requires: 'bills.manage', group: 'Payables' },
    { key: 'trial-balance', label: 'Trial Balance', path: 'reports/trial-balance', icon: 'scale', requires: 'reports.view', group: 'Reports' },
    { key: 'profit-and-loss', label: 'Profit & Loss', path: 'reports/profit-and-loss', icon: 'trending-up', requires: 'reports.view', group: 'Reports' },
    { key: 'balance-sheet', label: 'Balance Sheet', path: 'reports/balance-sheet', icon: 'columns', requires: 'reports.view', group: 'Reports' },
    { key: 'general-ledger', label: 'General Ledger', path: 'reports/general-ledger', icon: 'book-open', requires: 'reports.view', group: 'Reports' },
    { key: 'import', label: 'Import (AccountEdge)', path: 'import', icon: 'upload', requires: 'imports.manage', group: 'Data' },
    { key: 'tax-codes', label: 'Tax Codes', path: 'tax-codes', icon: 'percent', requires: 'tax.manage', group: 'Setup' },
    { key: 'settings', label: 'Company Settings', path: 'settings', icon: 'settings', requires: 'company.manage', group: 'Setup' },
  ],
  permissions: [
    { key: 'accounts.manage', name: 'Manage chart of accounts', description: 'Create and edit GL accounts', category: 'accounting' },
    { key: 'periods.manage', name: 'Manage accounting periods', description: 'Open, close, and lock periods', category: 'accounting' },
    { key: 'currency.manage', name: 'Manage currencies & rates', description: 'Maintain exchange rates', category: 'accounting' },
    { key: 'tax.manage', name: 'Manage tax codes', description: 'Configure tax codes and rates', category: 'accounting' },
    { key: 'journals.manage', name: 'Manage journal entries', description: 'Create and edit draft journal entries', category: 'accounting' },
    { key: 'journals.post', name: 'Post journal entries', description: 'Post and reverse journal entries', category: 'accounting' },
    { key: 'customers.manage', name: 'Manage customers', description: 'Create and edit customers', category: 'sales' },
    { key: 'suppliers.manage', name: 'Manage suppliers', description: 'Create and edit suppliers', category: 'purchases' },
    { key: 'banking.manage', name: 'Manage bank accounts', description: 'Create and edit bank accounts', category: 'banking' },
    { key: 'invoices.manage', name: 'Manage invoices', description: 'Create, edit, and post sales invoices', category: 'sales' },
    { key: 'bills.manage', name: 'Manage bills', description: 'Create, edit, and post supplier bills', category: 'purchases' },
    { key: 'imports.manage', name: 'Manage imports', description: 'Upload, validate, and commit imports', category: 'data' },
    { key: 'dashboards.manage', name: 'Manage dashboards', description: 'Configure dashboard layouts', category: 'reporting' },
    { key: 'reports.view', name: 'View reports', description: 'View financial reports', category: 'reporting' },
    { key: 'reports.export', name: 'Export reports', description: 'Generate report exports', category: 'reporting' },
  ],
  settings: [
    { key: 'default_currency', label: 'Default currency', type: 'string', description: 'Base currency for new companies', default: 'TTD' },
    { key: 'fiscal_year_start_month', label: 'Fiscal year start month', type: 'number', default: 1 },
  ],
};
