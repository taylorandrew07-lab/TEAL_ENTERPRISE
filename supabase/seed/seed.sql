-- =============================================================================
-- TEAL Enterprise — Reference seed data (NOT demo data)
-- -----------------------------------------------------------------------------
-- Only platform reference data: currencies, account types, the permission
-- catalogue, system role templates, and the module registry. No companies, no
-- customers, no transactions — those are created by real users. Idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Currencies
-- -----------------------------------------------------------------------------
insert into accounting.currencies (code, name, symbol, decimal_places) values
  ('TTD', 'Trinidad & Tobago Dollar', 'TT$', 2),
  ('USD', 'United States Dollar', '$', 2),
  ('GBP', 'Pound Sterling', '£', 2),
  ('EUR', 'Euro', '€', 2),
  ('CAD', 'Canadian Dollar', 'C$', 2)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Account types (system reference; drive debit/credit behaviour)
-- -----------------------------------------------------------------------------
insert into accounting.account_types (key, name, category, normal_balance, is_system) values
  ('bank',                 'Bank',                 'asset',     'debit',  true),
  ('current_asset',        'Current Asset',        'asset',     'debit',  true),
  ('accounts_receivable',  'Accounts Receivable',  'asset',     'debit',  true),
  ('fixed_asset',          'Fixed Asset',          'asset',     'debit',  true),
  ('other_asset',          'Other Asset',          'asset',     'debit',  true),
  ('current_liability',    'Current Liability',    'liability', 'credit', true),
  ('accounts_payable',     'Accounts Payable',     'liability', 'credit', true),
  ('tax_liability',        'Tax Liability',        'liability', 'credit', true),
  ('long_term_liability',  'Long Term Liability',  'liability', 'credit', true),
  ('equity',               'Equity',               'equity',    'credit', true),
  ('retained_earnings',    'Retained Earnings',    'equity',    'credit', true),
  ('income',               'Income',               'income',    'credit', true),
  ('other_income',         'Other Income',         'income',    'credit', true),
  ('cost_of_goods_sold',   'Cost of Goods Sold',   'expense',   'debit',  true),
  ('expense',              'Expense',              'expense',   'debit',  true),
  ('other_expense',        'Other Expense',        'expense',   'debit',  true)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Permission catalogue (keys referenced by RLS policies & posting functions)
-- -----------------------------------------------------------------------------
insert into core.permissions (key, name, description, category) values
  ('company.manage',    'Manage company settings',   'Edit company profile, settings, numbering', 'admin'),
  ('users.manage',      'Manage users & roles',      'Invite users, assign roles, edit roles',    'admin'),
  ('audit.view',        'View audit trail',          'Read the company audit log',                'admin'),
  ('clients.manage',    'Manage clients',            'Create and edit platform clients',          'core'),
  ('documents.manage',  'Manage documents',          'Upload and manage documents',               'core'),
  ('accounts.manage',   'Manage chart of accounts',  'Create and edit GL accounts',               'accounting'),
  ('periods.manage',    'Manage accounting periods', 'Open, close, and lock periods',             'accounting'),
  ('currency.manage',   'Manage currencies & rates', 'Maintain exchange rates',                   'accounting'),
  ('tax.manage',        'Manage tax codes',          'Configure tax codes and rates',             'accounting'),
  ('journals.manage',   'Manage journal entries',    'Create and edit draft journal entries',     'accounting'),
  ('journals.post',     'Post journal entries',      'Post and reverse journal entries',          'accounting'),
  ('customers.manage',  'Manage customers',          'Create and edit customers',                 'sales'),
  ('suppliers.manage',  'Manage suppliers',          'Create and edit suppliers',                 'purchases'),
  ('banking.manage',    'Manage bank accounts',      'Create and edit bank accounts',             'banking'),
  ('invoices.manage',   'Manage invoices',           'Create, edit, and post sales invoices',     'sales'),
  ('bills.manage',      'Manage bills',              'Create, edit, and post supplier bills',     'purchases'),
  ('imports.manage',    'Manage imports',            'Upload, validate, and commit imports',      'data'),
  ('dashboards.manage', 'Manage dashboards',         'Configure dashboard layouts',               'reporting'),
  ('reports.view',      'View reports',              'View financial reports',                    'reporting'),
  ('reports.export',    'Export reports',            'Generate report exports',                   'reporting')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- System role templates (company_id null, is_system true).
-- Memberships may reference these directly across companies.
-- "Super Admin" is also expressed by core.users.is_super_admin = true (RLS bypass).
-- -----------------------------------------------------------------------------
insert into core.roles (company_id, key, name, description, is_system) values
  (null, 'super_admin',  'Super Admin',             'Platform-wide administrator', true),
  (null, 'company_admin','Company Admin',           'Full access within a company', true),
  (null, 'accountant',   'Accountant / Admin User', 'Full accounting access', true),
  (null, 'office_user',  'Office User',             'Day-to-day sales/purchases entry', true),
  (null, 'view_only',    'View-only User',          'Read-only access', true)
on conflict (company_id, key) do nothing;

-- super_admin & company_admin: every permission.
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
cross join core.permissions p
where r.is_system and r.key in ('super_admin', 'company_admin')
on conflict do nothing;

-- accountant: all accounting + reporting + reads.
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on p.key in (
  'accounts.manage','periods.manage','currency.manage','tax.manage',
  'journals.manage','journals.post','customers.manage','suppliers.manage',
  'banking.manage','invoices.manage','bills.manage','imports.manage',
  'dashboards.manage','reports.view','reports.export','audit.view','documents.manage'
)
where r.is_system and r.key = 'accountant'
on conflict do nothing;

-- office_user: operational AR/AP entry, no posting/period/admin power.
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on p.key in (
  'customers.manage','suppliers.manage','invoices.manage','bills.manage',
  'documents.manage','reports.view','dashboards.manage'
)
where r.is_system and r.key = 'office_user'
on conflict do nothing;

-- view_only: reporting read only.
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on p.key in ('reports.view')
where r.is_system and r.key = 'view_only'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Module registry. Accounting is live; future modules are registered (not built).
-- -----------------------------------------------------------------------------
insert into core.modules (key, name, description) values
  ('accounting',        'Accounting',          'General ledger, AR, AP, banking, reporting'),
  ('cargo_assurance',    'TEAL Cargo Assurance', 'Periodic cargo measurement, reconciliation and loss assurance'),
  ('survey',            'Survey Management',   'Marine & cargo survey management (planned)'),
  ('claims',            'Claims Management',   'Claims handling (planned)'),
  ('cargo_monitoring',  'Cargo Monitoring',    'Cargo monitoring (planned; own schema cargo_monitoring)'),
  ('ship_agency',       'Ship Agency',         'Ship agency operations (planned)'),
  ('freight',           'Freight Forwarding',  'Freight forwarding (planned)'),
  ('compliance',        'Compliance',          'Compliance (planned)'),
  ('documents',         'Document Management', 'Document management (planned)'),
  ('reporting',         'Reporting & Analytics','Cross-module analytics (planned)'),
  ('administration',    'Administration',      'Platform administration')
on conflict (key) do nothing;

-- =============================================================================
-- Cargo Assurance module (module #2) — reference seed
-- Mirrors src/core/modules/manifests/cargo-assurance.ts. See docs/cargo-assurance/_CARGO-SPEC.md.
-- =============================================================================

-- Permission catalogue (category 'cargo'). External portal permission flagged in description.
insert into core.permissions (key, name, description, category) values
  ('cargo.reviews.manage',     'Manage assurance reviews',      'Create and edit assurance reviews and scope',                 'cargo'),
  ('cargo.reviews.review',     'Review assurance reviews',      'Mark reviews as reviewed; resolve findings',                  'cargo'),
  ('cargo.reviews.publish',    'Approve & publish reviews',     'Approve and publish a review snapshot to the client',         'cargo'),
  ('cargo.documents.upload',   'Upload source documents',       'Bulk-upload certificates and reports',                        'cargo'),
  ('cargo.extraction.correct', 'Correct extracted values',      'Edit extracted fields (originals preserved)',                 'cargo'),
  ('cargo.data.review',        'Review extracted data',         'Use the data-review workspace; resolve exceptions',           'cargo'),
  ('cargo.config.manage',      'Manage cargo configuration',     'Procedures, extraction templates, cargo types, calculation methods', 'cargo'),
  ('cargo.assets.manage',      'Manage terminals/vessels/meters','Maintain physical assets and meters',                        'cargo'),
  ('cargo.reports.view',       'View cargo analysis',            'View dashboards, analysis and reports (internal)',            'cargo'),
  ('cargo.reports.export',     'Export cargo reports',           'Generate PDF/Excel assurance reports',                        'cargo'),
  ('cargo.client.view',        'Client portal view',            'External read-only access to own client published reviews',   'cargo')
on conflict (key) do nothing;

-- Module system roles (company_id null, is_system true). Internal Taylor roles + external client roles.
insert into core.roles (company_id, key, name, description, is_system) values
  (null, 'ca_admin',         'Cargo Assurance Administrator', 'Full Cargo Assurance module control',                 true),
  (null, 'ca_analyst',       'Cargo Assurance Analyst',       'Upload, validate, analyse',                          true),
  (null, 'ca_reviewer',      'Cargo Reviewer / Publisher',   'Approve and publish reviews',                        true),
  (null, 'ca_client_admin',  'Client Administrator',         'External: read-only + manage own client viewers',    true),
  (null, 'ca_client_viewer', 'Client Viewer',                'External: read-only published dashboards & reports',  true)
on conflict (company_id, key) do nothing;

-- Super Admin & Company Admin already get every permission via the cross join above; re-run to
-- include the newly-added cargo permissions.
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
cross join core.permissions p
where r.is_system and r.key in ('super_admin', 'company_admin')
on conflict do nothing;

-- ca_admin: every internal cargo permission.
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on p.key in (
  'cargo.reviews.manage','cargo.reviews.review','cargo.reviews.publish','cargo.documents.upload',
  'cargo.extraction.correct','cargo.data.review','cargo.config.manage','cargo.assets.manage',
  'cargo.reports.view','cargo.reports.export','documents.manage','clients.manage','audit.view'
)
where r.is_system and r.key = 'ca_admin'
on conflict do nothing;

-- ca_analyst: upload/validate/analyse, no publish/config.
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on p.key in (
  'cargo.reviews.manage','cargo.documents.upload','cargo.extraction.correct','cargo.data.review',
  'cargo.assets.manage','cargo.reports.view','cargo.reports.export'
)
where r.is_system and r.key = 'ca_analyst'
on conflict do nothing;

-- ca_reviewer: review + publish + view/export.
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on p.key in (
  'cargo.reviews.review','cargo.reviews.publish','cargo.reports.view','cargo.reports.export','cargo.data.review'
)
where r.is_system and r.key = 'ca_reviewer'
on conflict do nothing;

-- ca_client_admin & ca_client_viewer: external read-only portal access only.
insert into core.role_permissions (role_id, permission_id)
select r.id, p.id
from core.roles r
join core.permissions p on p.key = 'cargo.client.view'
where r.is_system and r.key in ('ca_client_admin', 'ca_client_viewer')
on conflict do nothing;

-- Liquid cargo types — system reference (added in migration 0007). Densities are
-- ILLUSTRATIVE @15°C defaults the user can adjust; a parcel's real density always
-- comes from its certificate. Idempotent.
insert into cargo.cargo_types (key, name, category, default_density_kg_m3) values
  ('gasoil_diesel',     'Gasoil / Automotive Diesel', 'petroleum',     840.0),
  ('gasoline',          'Gasoline / Motor Spirit',    'petroleum',     745.0),
  ('jet_a1',            'Jet A-1 / Kerosene',         'petroleum',     800.0),
  ('fuel_oil_hsfo',     'Heavy Fuel Oil (HSFO)',      'petroleum',     985.0),
  ('fuel_oil_vlsfo',    'Very Low Sulphur Fuel Oil',  'petroleum',     920.0),
  ('marine_gasoil',     'Marine Gasoil (MGO)',        'petroleum',     860.0),
  ('crude_oil',         'Crude Oil',                  'petroleum',     870.0),
  ('lube_oil',          'Lubricating Oil',            'petroleum',     880.0),
  ('base_oil',          'Base Oil',                   'petroleum',     870.0),
  ('bitumen_asphalt',   'Bitumen / Asphalt',          'petroleum',    1010.0),
  ('vegetable_oil',     'Vegetable Oil',              'vegetable_oil', 915.0),
  ('molasses',          'Molasses',                   'other',        1420.0),
  ('methanol',          'Methanol',                   'chemical',      792.0),
  ('ethanol',           'Ethanol',                    'chemical',      789.0),
  ('caustic_soda',      'Caustic Soda Solution',      'chemical',     1525.0),
  ('other_liquid',      'Other Liquid Cargo',         'other',         null)
on conflict (key) do nothing;
