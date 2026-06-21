// =============================================================================
// TEAL Enterprise — Module registry
// -----------------------------------------------------------------------------
// The platform core consumes this registry to build the module launcher, render
// per-module navigation, gate routes, and verify the DB permission seed. Adding a
// module = author its manifest and register it here (plus its migrations + seed).
// Pure TypeScript: no database dependency, unit-testable without Supabase.
// See docs/platform-module-framework.md §5 and §9.
// =============================================================================
import type { ModuleManifest, ModulePermission, NavItem } from './types';
import { accountingManifest } from './manifests/accounting';
import { cargoAssuranceManifest } from './manifests/cargo-assurance';

/** All modules known to the platform, in launcher order. */
export const MODULES: ModuleManifest[] = [accountingManifest, cargoAssuranceManifest];

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

/** Look up a module manifest by its registry key. */
export function getModule(key: string): ModuleManifest | undefined {
  return BY_KEY.get(key);
}

/** Resolve a module from a request path, e.g. '/fuel-assurance/reviews' -> fuel manifest. */
export function getModuleForPath(pathname: string): ModuleManifest | undefined {
  return MODULES.find((m) => pathname === m.route || pathname.startsWith(m.route + '/'));
}

/**
 * Modules visible in the launcher for a company + user.
 * @param enabledKeys  module keys enabled for the active company (core.company_modules).
 * @param isSuperAdmin super admins see every non-archived module regardless of enablement.
 * @param canBeta      whether the user holds the `platform.beta` privilege; beta-status
 *                     modules (and their "Beta" badge) are hidden from users without it.
 */
export function visibleModules(
  enabledKeys: Iterable<string>,
  isSuperAdmin = false,
  canBeta = false,
): ModuleManifest[] {
  const enabled = new Set(enabledKeys);
  return MODULES.filter(
    (m) =>
      m.status !== 'archived' &&
      (m.status !== 'beta' || canBeta) &&
      (isSuperAdmin || (m.status !== 'planned' && enabled.has(m.key))),
  );
}

/**
 * Navigation items within a module the user may see, filtered by held permissions.
 * UI gate only — Postgres RLS remains the authoritative access control.
 */
export function navForUser(moduleKey: string, permissions: Iterable<string>): NavItem[] {
  const mod = BY_KEY.get(moduleKey);
  if (!mod) return [];
  const held = new Set(permissions);
  return mod.navigation.filter((n) => !n.hidden && (!n.requires || held.has(n.requires)));
}

/** Every permission across all modules — the source list the DB seed must mirror. */
export function allModulePermissions(): (ModulePermission & { module: string })[] {
  return MODULES.flatMap((m) => m.permissions.map((p) => ({ ...p, module: m.key })));
}

/** The Postgres schemas owned by modules — must be distinct (one schema per module). */
export function moduleSchemas(): string[] {
  return MODULES.map((m) => m.schema);
}
