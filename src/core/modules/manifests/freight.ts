// =============================================================================
// TEAL Enterprise — Freight Forwarding module manifest (Jupiter Logistics)
// -----------------------------------------------------------------------------
// Declarative description consumed by the platform core. Permission keys mirror
// the freight.* rows seeded in supabase/seed/seed.sql (core.permissions).
// The module is the freight-forwarding operating system; "Jupiter Logistics" is
// the operating company (a core.companies tenant) with this module enabled.
// Everything revolves around ONE object: the Shipment (Job). The Shipment
// Workspace (/freight/shipments/[id]) is the single source of truth.
// AI/email integration seams are built into the schema now (freight.ai_jobs,
// freight.prompts, freight.mailboxes) and switched on later — see
// docs/freight/_FREIGHT-SPEC.md.
// =============================================================================
import type { ModuleManifest } from '../types';

export const freightManifest: ModuleManifest = {
  key: 'freight',
  name: 'Jupiter Logistics',
  tagline: 'Freight forwarding operations — every shipment, one workspace.',
  description:
    'The complete operating platform for freight forwarding: enquiries, RFQs and ' +
    'quotations, bookings, milestones, tasks, containers and free-time, documents, ' +
    'a per-shipment communication centre, and operational profitability. Built so ' +
    'AI and Microsoft 365 email can be switched on later without rework.',
  route: '/freight',
  schema: 'freight',
  status: 'live',
  icon: 'truck',
  enabledByDefault: false,
  navigation: [
    { key: 'dashboard', label: 'Dashboard', path: '', icon: 'gauge', requires: 'freight.reports.view' },
    { key: 'search', label: 'Search', path: 'search', icon: 'search' },
    { key: 'shipments', label: 'Shipments', path: 'shipments', icon: 'package', requires: 'freight.shipments.manage' },
    { key: 'quotes', label: 'Quotes', path: 'quotes', icon: 'file-text', requires: 'freight.quotes.manage' },
    { key: 'tasks', label: 'Tasks', path: 'tasks', icon: 'clipboard-check', requires: 'freight.shipments.manage' },
    { key: 'containers', label: 'Containers', path: 'containers', icon: 'boxes', requires: 'freight.containers.manage' },
    { key: 'contacts', label: 'Contacts', path: 'contacts', icon: 'users', requires: 'freight.contacts.manage', group: 'Directory' },
    { key: 'documents', label: 'Documents', path: 'documents', icon: 'paperclip', requires: 'freight.documents.manage', group: 'Directory' },
    { key: 'settings', label: 'Settings', path: 'settings', icon: 'settings', requires: 'freight.comms.manage', group: 'Configuration' },
  ],
  permissions: [
    { key: 'freight.shipments.manage',  name: 'Manage shipments',        description: 'Create and edit shipments, advance lifecycle stage, manage tasks & milestones', category: 'freight' },
    { key: 'freight.quotes.manage',     name: 'Manage quotes',           description: 'Create RFQs, record supplier quotes, prepare customer quotations',           category: 'freight' },
    { key: 'freight.contacts.manage',   name: 'Manage contacts',         description: 'Maintain the freight CRM (clients, carriers, agents, brokers, truckers)',     category: 'freight' },
    { key: 'freight.containers.manage', name: 'Manage containers',       description: 'Track containers, free time, demurrage and detention',                       category: 'freight' },
    { key: 'freight.documents.manage',  name: 'Manage freight documents', description: 'Upload, generate and link shipment documents',                              category: 'freight' },
    { key: 'freight.comms.manage',      name: 'Manage communications',   description: 'Log/send communications and manage connected mailboxes',                     category: 'freight' },
    { key: 'freight.finance.manage',    name: 'Manage freight finance',  description: 'Record supplier costs and customer charges; view profitability',             category: 'freight' },
    { key: 'freight.reports.view',      name: 'View freight dashboards', description: 'View the operational dashboard, analysis and reports',                       category: 'freight' },
    { key: 'freight.reports.export',    name: 'Export freight reports',  description: 'Generate freight report exports',                                            category: 'freight' },
    { key: 'freight.ai.manage',         name: 'Manage AI automation',    description: 'Configure prompts and enable AI-performed steps (dormant until switched on)', category: 'freight' },
    { key: 'freight.client.view',       name: 'Customer portal view',    description: 'External read-only access for customers to their own shipments',              category: 'freight', external: true },
  ],
  settings: [
    { key: 'reference_prefix', label: 'Shipment reference prefix', type: 'string', description: 'Prefix for shipment references, e.g. JL gives JL-2026-00142', default: 'JL' },
    { key: 'default_incoterm', label: 'Default Incoterm', type: 'select', default: 'CIF', options: [
      { value: 'EXW', label: 'EXW — Ex Works' },
      { value: 'FCA', label: 'FCA — Free Carrier' },
      { value: 'FOB', label: 'FOB — Free On Board' },
      { value: 'CFR', label: 'CFR — Cost & Freight' },
      { value: 'CIF', label: 'CIF — Cost, Insurance & Freight' },
      { value: 'DAP', label: 'DAP — Delivered At Place' },
      { value: 'DDP', label: 'DDP — Delivered Duty Paid' },
    ] },
    { key: 'default_currency', label: 'Default quoting currency', type: 'string', description: 'ISO code used as the default for quotes and charges', default: 'USD' },
  ],
};
