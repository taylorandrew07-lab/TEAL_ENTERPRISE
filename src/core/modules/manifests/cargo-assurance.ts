// =============================================================================
// TEAL Enterprise — Cargo Assurance module manifest (module #2)
// -----------------------------------------------------------------------------
// Declarative description consumed by the platform core. Permission keys mirror
// the cargo.* rows seeded in supabase/seed/seed.sql (core.permissions).
// Handles ANY liquid bulk cargo (fuels, gasoil, gasoline, crude, lube/base oils,
// vegetable oils, chemicals, molasses, ...) plus vessel bunker on/off-hire surveys.
// Navigation is review-period-first: "New Loadout" is intentionally NOT a primary
// item. See docs/cargo-assurance/_CARGO-SPEC.md and docs/platform-module-framework.md.
// =============================================================================
import type { ModuleManifest } from '../types';

export const cargoAssuranceManifest: ModuleManifest = {
  key: 'cargo_assurance',
  name: 'TEAL Cargo Assurance',
  tagline: 'Periodic liquid-cargo measurement, reconciliation and loss assurance.',
  description:
    'Retrospective, batch analytical and reporting system for liquid bulk cargo. Bulk-upload a ' +
    "period of certificates and reports; the system extracts and reconstructs loadouts, applies " +
    'client and Taylor-corrected reconciliation logic (in volume or mass), aggregates across the ' +
    'review period, and publishes an assurance report.',
  route: '/cargo-assurance',
  schema: 'cargo',
  status: 'beta',
  icon: 'droplet',
  enabledByDefault: false,
  // Nav reflects shipped routes; import / data-review / analysis / assets / methods
  // are added as the extraction + analytics pipeline ships (permissions already exist).
  navigation: [
    { key: 'portfolio', label: 'Portfolio Overview', path: '', icon: 'gauge', requires: 'cargo.reports.view' },
    { key: 'reviews', label: 'Assurance Reviews', path: 'reviews', icon: 'clipboard-check', requires: 'cargo.reviews.manage' },
    { key: 'clients', label: 'Clients', path: 'clients', icon: 'users', requires: 'cargo.config.manage', group: 'Configuration' },
    { key: 'cargo-types', label: 'Cargo Types', path: 'cargo-types', icon: 'droplet', requires: 'cargo.config.manage', group: 'Configuration' },
  ],
  permissions: [
    { key: 'cargo.reviews.manage', name: 'Manage assurance reviews', description: 'Create and edit assurance reviews and scope', category: 'cargo' },
    { key: 'cargo.reviews.review', name: 'Review assurance reviews', description: 'Mark reviews as reviewed; resolve findings', category: 'cargo' },
    { key: 'cargo.reviews.publish', name: 'Approve & publish reviews', description: 'Approve and publish a review snapshot to the client', category: 'cargo' },
    { key: 'cargo.documents.upload', name: 'Upload source documents', description: 'Bulk-upload certificates and reports', category: 'cargo' },
    { key: 'cargo.extraction.correct', name: 'Correct extracted values', description: 'Edit extracted fields (originals preserved)', category: 'cargo' },
    { key: 'cargo.data.review', name: 'Review extracted data', description: 'Use the data-review workspace; resolve exceptions', category: 'cargo' },
    { key: 'cargo.config.manage', name: 'Manage cargo configuration', description: 'Procedures, extraction templates, cargo types, calculation methods', category: 'cargo' },
    { key: 'cargo.assets.manage', name: 'Manage terminals/vessels/meters', description: 'Maintain physical assets and meters', category: 'cargo' },
    { key: 'cargo.reports.view', name: 'View cargo analysis', description: 'View dashboards, analysis and reports (internal)', category: 'cargo' },
    { key: 'cargo.reports.export', name: 'Export cargo reports', description: 'Generate PDF/Excel assurance reports', category: 'cargo' },
    { key: 'cargo.client.view', name: 'Client portal view', description: 'External read-only access to own client published reviews', category: 'cargo', external: true },
  ],
  settings: [
    { key: 'min_sample_size', label: 'Minimum sample size for trend findings', type: 'number', description: 'No strong trend conclusion below this many loadouts', default: 12 },
    { key: 'default_reference_method', label: 'Default comparison reference method', type: 'select', default: 'taylor_corrected', options: [
      { value: 'vessel_sounding', label: 'Vessel manual soundings' },
      { value: 'vessel_meter', label: 'Vessel flow meter' },
      { value: 'shore_meter', label: 'Shore flow meter' },
      { value: 'shore_tank', label: 'Shore tank soundings' },
      { value: 'fueltrax', label: 'FuelTrax' },
      { value: 'taylor_corrected', label: 'Taylor corrected reconciliation' },
    ] },
    { key: 'default_volume_basis', label: 'Default standard-volume basis', type: 'select', default: 'none', options: [
      { value: 'none', label: 'As measured (flag if missing)' },
      { value: 'at_15c', label: 'Standard volume @ 15°C' },
      { value: 'at_60f', label: 'Standard volume @ 60°F' },
    ] },
    { key: 'default_quantity_basis', label: 'Default quantity basis', type: 'select', default: 'volume', options: [
      { value: 'volume', label: 'Volume' },
      { value: 'mass', label: 'Mass (metric tonnes)' },
    ] },
    { key: 'allow_client_cobranding', label: 'Allow client co-branding on reports', type: 'boolean', default: true },
  ],
};
