// =============================================================================
// TEAL Enterprise — Module Framework: manifest contract
// -----------------------------------------------------------------------------
// The declarative contract every module implements so the platform core can host
// it without knowing its internals: navigation, permissions, settings, route.
// Pure types + data — no database, no Supabase. See docs/platform-module-framework.md.
// =============================================================================

/** Lifecycle/availability of a module across the platform. */
export type ModuleStatus = 'live' | 'beta' | 'planned' | 'archived';

/** A navigation entry shown within a module (sidebar/top nav). */
export interface NavItem {
  /** Stable id, unique within the module. */
  key: string;
  /** Display label. */
  label: string;
  /** Route relative to the module route, e.g. 'reviews' -> /fuel-assurance/reviews. */
  path: string;
  /** Optional icon token from the design system. */
  icon?: string;
  /** Permission key required to see/use this item (UI gate; RLS is authoritative). */
  requires?: string;
  /** Optional grouping label for sectioned navigation. */
  group?: string;
  /** Hide from primary nav (still routable) — e.g. detail/drilldown screens. */
  hidden?: boolean;
}

/** A permission the module defines; mirrored into core.permissions by the seed. */
export interface ModulePermission {
  /** Namespaced key, e.g. 'cargo.reviews.publish'. */
  key: string;
  /** Human name. */
  name: string;
  /** What it allows. */
  description: string;
  /**
   * Catalogue category (must match the seeded core.permissions.category). This is
   * the single source of truth — never derive the category from the module key.
   */
  category: string;
  /** True for external/portal (non-tenant) permissions, e.g. client viewers. */
  external?: boolean;
}

/** A typed per-company setting, stored in core.company_modules.settings (jsonb). */
export interface ModuleSettingField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'json';
  description?: string;
  required?: boolean;
  default?: string | number | boolean | null;
  /** Options when type === 'select'. */
  options?: { value: string; label: string }[];
}

/** The full declarative description of a module consumed by the core. */
export interface ModuleManifest {
  /** Registry key; matches core.modules.key. */
  key: string;
  /** Display name. */
  name: string;
  /** Short launcher subtitle. */
  tagline: string;
  /** Longer description. */
  description: string;
  /** Base route, e.g. '/fuel-assurance'. */
  route: string;
  /** Postgres schema owned by the module, e.g. 'fuel'. */
  schema: string;
  /** Availability. */
  status: ModuleStatus;
  /** Optional design-system icon token. */
  icon?: string;
  /** In-module navigation. */
  navigation: NavItem[];
  /** Permission catalogue (source of truth the DB seed mirrors). */
  permissions: ModulePermission[];
  /** Typed per-company settings schema. */
  settings?: ModuleSettingField[];
  /** Whether a newly-created company has this module on by default. */
  enabledByDefault?: boolean;
}
