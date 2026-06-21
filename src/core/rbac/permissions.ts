// Canonical permission keys, mirrored from supabase/seed/seed.sql (core.permissions).
// These are used for UI gating ONLY. They are never the sole access gate — RLS in
// Postgres is authoritative. Keep this list in sync with the seed.
export const PERMISSIONS = {
  COMPANY_MANAGE: 'company.manage',
  USERS_MANAGE: 'users.manage',
  AUDIT_VIEW: 'audit.view',
  CLIENTS_MANAGE: 'clients.manage',
  DOCUMENTS_MANAGE: 'documents.manage',
  ACCOUNTS_MANAGE: 'accounts.manage',
  PERIODS_MANAGE: 'periods.manage',
  CURRENCY_MANAGE: 'currency.manage',
  TAX_MANAGE: 'tax.manage',
  JOURNALS_MANAGE: 'journals.manage',
  JOURNALS_POST: 'journals.post',
  CUSTOMERS_MANAGE: 'customers.manage',
  SUPPLIERS_MANAGE: 'suppliers.manage',
  BANKING_MANAGE: 'banking.manage',
  INVOICES_MANAGE: 'invoices.manage',
  BILLS_MANAGE: 'bills.manage',
  IMPORTS_MANAGE: 'imports.manage',
  DASHBOARDS_MANAGE: 'dashboards.manage',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Cargo Assurance module permission keys (category 'cargo'). Mirrored from
// src/core/modules/manifests/cargo-assurance.ts and supabase/seed/seed.sql.
export const CARGO_PERMISSIONS = {
  REVIEWS_MANAGE: 'cargo.reviews.manage',
  REVIEWS_REVIEW: 'cargo.reviews.review',
  REVIEWS_PUBLISH: 'cargo.reviews.publish',
  DOCUMENTS_UPLOAD: 'cargo.documents.upload',
  EXTRACTION_CORRECT: 'cargo.extraction.correct',
  DATA_REVIEW: 'cargo.data.review',
  CONFIG_MANAGE: 'cargo.config.manage',
  ASSETS_MANAGE: 'cargo.assets.manage',
  REPORTS_VIEW: 'cargo.reports.view',
  REPORTS_EXPORT: 'cargo.reports.export',
  CLIENT_VIEW: 'cargo.client.view',
} as const;

export const SYSTEM_ROLE_KEYS = [
  'super_admin',
  'company_admin',
  'accountant',
  'office_user',
  'view_only',
  // Cargo Assurance module roles (internal Taylor + external client portal).
  'ca_admin',
  'ca_analyst',
  'ca_reviewer',
  'ca_client_admin',
  'ca_client_viewer',
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];
