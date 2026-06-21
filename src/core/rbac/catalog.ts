// =============================================================================
// TEAL Enterprise — RBAC catalogue (SINGLE SOURCE OF TRUTH)
// -----------------------------------------------------------------------------
// The one place that defines every permission and every system role + its grants.
// Module permissions come from the module manifests (registry); core permissions
// are defined here. The DB seed (supabase/seed/seed.sql) MUST mirror this catalogue
// — enforced by src/core/rbac/__tests__/permissions-parity.test.ts. Adding a module
// permission is done in the manifest only; adding a core permission, here only.
// =============================================================================
import { allModulePermissions } from '@/core/modules/registry';

export interface PermissionDef {
  key: string;
  name: string;
  description: string;
  /** Maps to core.permissions.category. */
  category: string;
  /** External/portal permission (non-tenant). */
  external?: boolean;
}

/** Core (non-module) platform permissions. Categories match the seed. */
export const CORE_PERMISSIONS: PermissionDef[] = [
  { key: 'company.manage', name: 'Manage company settings', description: 'Edit company profile, settings, numbering', category: 'admin' },
  { key: 'users.manage', name: 'Manage users & roles', description: 'Invite users, assign roles, edit roles', category: 'admin' },
  { key: 'audit.view', name: 'View audit trail', description: 'Read the company audit log', category: 'admin' },
  { key: 'platform.beta', name: 'Access beta features', description: 'See and use features marked Beta', category: 'admin' },
  { key: 'private.view', name: 'View private (management) accounting', description: 'Parallel FX rates and VAT-position management overlay', category: 'admin' },
  { key: 'clients.manage', name: 'Manage clients', description: 'Create and edit platform clients', category: 'core' },
  { key: 'documents.manage', name: 'Manage documents', description: 'Upload and manage documents', category: 'core' },
];

export const CORE_PERMISSION_KEYS = CORE_PERMISSIONS.map((p) => p.key);

/** The complete permission catalogue: core + every module's permissions. */
export function allPermissions(): PermissionDef[] {
  const fromModules: PermissionDef[] = allModulePermissions().map((p) => ({
    key: p.key,
    name: p.name,
    description: p.description,
    category: p.category,
    external: p.external,
  }));
  return [...CORE_PERMISSIONS, ...fromModules];
}

/** Every permission key, core + modules. Super admins effectively hold all of these. */
export function allPermissionKeys(): string[] {
  return allPermissions().map((p) => p.key);
}

export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  /** 'all' grants every permission; otherwise an explicit key list. */
  grants: 'all' | string[];
}

/**
 * System role templates (company_id null) and their grants. This is the authority
 * the seed's core.roles + core.role_permissions blocks mirror.
 */
export const SYSTEM_ROLES: SystemRoleDef[] = [
  { key: 'super_admin', name: 'Super Admin', description: 'Platform-wide administrator', grants: 'all' },
  { key: 'company_admin', name: 'Company Admin', description: 'Full access within a company', grants: 'all' },
  {
    key: 'accountant',
    name: 'Accountant / Admin User',
    description: 'Full accounting access',
    grants: [
      'accounts.manage', 'periods.manage', 'currency.manage', 'tax.manage',
      'journals.manage', 'journals.post', 'customers.manage', 'suppliers.manage',
      'banking.manage', 'invoices.manage', 'bills.manage', 'imports.manage',
      'dashboards.manage', 'reports.view', 'reports.export', 'audit.view', 'documents.manage',
    ],
  },
  {
    key: 'office_user',
    name: 'Office User',
    description: 'Day-to-day sales/purchases entry',
    grants: [
      'customers.manage', 'suppliers.manage', 'invoices.manage', 'bills.manage',
      'documents.manage', 'reports.view', 'dashboards.manage',
    ],
  },
  { key: 'view_only', name: 'View-only User', description: 'Read-only access', grants: ['reports.view'] },
  {
    key: 'ca_admin',
    name: 'Cargo Assurance Administrator',
    description: 'Full Cargo Assurance module control',
    grants: [
      'cargo.reviews.manage', 'cargo.reviews.review', 'cargo.reviews.publish', 'cargo.documents.upload',
      'cargo.extraction.correct', 'cargo.data.review', 'cargo.config.manage', 'cargo.assets.manage',
      'cargo.reports.view', 'cargo.reports.export', 'documents.manage', 'clients.manage', 'audit.view',
    ],
  },
  {
    key: 'ca_analyst',
    name: 'Cargo Assurance Analyst',
    description: 'Upload, validate, analyse',
    grants: [
      'cargo.reviews.manage', 'cargo.documents.upload', 'cargo.extraction.correct', 'cargo.data.review',
      'cargo.assets.manage', 'cargo.reports.view', 'cargo.reports.export',
    ],
  },
  {
    key: 'ca_reviewer',
    name: 'Cargo Reviewer / Publisher',
    description: 'Approve and publish reviews',
    grants: ['cargo.reviews.review', 'cargo.reviews.publish', 'cargo.reports.view', 'cargo.reports.export', 'cargo.data.review'],
  },
  { key: 'ca_client_admin', name: 'Client Administrator', description: 'External: read-only + manage own client viewers', grants: ['cargo.client.view'] },
  { key: 'ca_client_viewer', name: 'Client Viewer', description: 'External: read-only published dashboards & reports', grants: ['cargo.client.view'] },
];

export const SYSTEM_ROLE_KEYS = SYSTEM_ROLES.map((r) => r.key);
