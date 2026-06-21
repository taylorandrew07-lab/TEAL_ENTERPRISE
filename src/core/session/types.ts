// =============================================================================
// TEAL Enterprise — Platform session/context contract
// -----------------------------------------------------------------------------
// The typed answer to "who is the user, which company is active, what may they
// do, and which modules are enabled" — the context every module renders inside.
// Resolved server-side from Supabase Auth + core tables. See src/core/session/context.ts.
// =============================================================================

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  isSuperAdmin: boolean;
}

export interface SessionCompany {
  id: string;
  name: string;
}

/**
 * Platform context status:
 *  - 'unconfigured'    — Supabase env not set (e.g. before provisioning). Shell shows a connect state.
 *  - 'unauthenticated' — no signed-in user.
 *  - 'no_company'      — signed in but no active/available company membership.
 *  - 'ready'           — fully resolved.
 */
export type PlatformStatus = 'unconfigured' | 'unauthenticated' | 'no_company' | 'ready';

export interface PlatformContext {
  status: PlatformStatus;
  user: SessionUser | null;
  companies: SessionCompany[];
  activeCompanyId: string | null;
  /** core.modules keys enabled for the active company. */
  enabledModuleKeys: string[];
  /** permission keys the user holds in the active company (super admins hold all). */
  permissions: string[];
  isSuperAdmin: boolean;
}

export const EMPTY_CONTEXT: PlatformContext = {
  status: 'unconfigured',
  user: null,
  companies: [],
  activeCompanyId: null,
  enabledModuleKeys: [],
  permissions: [],
  isSuperAdmin: false,
};

/** Convenience: does this context grant a permission key? */
export function can(ctx: PlatformContext, permission: string): boolean {
  return ctx.isSuperAdmin || ctx.permissions.includes(permission);
}
