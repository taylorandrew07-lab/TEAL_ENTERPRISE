// =============================================================================
// Permission catalogue PARITY TEST
// -----------------------------------------------------------------------------
// Enforces that the single-source RBAC catalogue (src/core/rbac/catalog.ts, fed by
// the module manifests) stays in lock-step with the DB seed (supabase/seed/seed.sql)
// and the typed UI constants (src/core/rbac/permissions.ts). This is the CI guard
// that makes "add a module" safe: a permission key in a manifest but missing from
// the seed (a silent UI/RLS lock-out) fails the build here.
// =============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { allPermissions, SYSTEM_ROLES, SYSTEM_ROLE_KEYS as CATALOG_ROLE_KEYS } from '@/core/rbac/catalog';
import { PERMISSIONS, CARGO_PERMISSIONS, SYSTEM_ROLE_KEYS } from '@/core/rbac/permissions';
import { moduleSchemas } from '@/core/modules/registry';

const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(resolve(here, '../../../../supabase/seed/seed.sql'), 'utf8');

/** Parse `('a','b','c','d')` 4-quoted tuples — only core.permissions rows match this shape. */
function parsePermissionRows(sql: string): Map<string, { name: string; description: string; category: string }> {
  const re = /\(\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'\s*\)/g;
  const out = new Map<string, { name: string; description: string; category: string }>();
  for (const m of sql.matchAll(re)) {
    out.set(m[1], { name: m[2], description: m[3], category: m[4] });
  }
  return out;
}

/** Parse `(null, 'key', 'name', 'desc', true)` core.roles tuples. */
function parseRoleKeys(sql: string): Set<string> {
  const re = /\(\s*null,\s*'([^']+)',\s*'[^']*',\s*'[^']*',\s*(?:true|false)\s*\)/g;
  const out = new Set<string>();
  for (const m of sql.matchAll(re)) out.add(m[1]);
  return out;
}

/** Parse role_permissions grant statements → role key -> 'all' | Set<permission key>. */
function parseGrants(sql: string): Map<string, 'all' | Set<string>> {
  const grants = new Map<string, 'all' | Set<string>>();
  for (const stmt of sql.split(';')) {
    if (!stmt.includes('role_permissions')) continue;
    // target role(s)
    let roles: string[] = [];
    const inList = stmt.match(/r\.key\s+in\s*\(([^)]*)\)/);
    const single = stmt.match(/r\.key\s*=\s*'([^']+)'/);
    if (inList) roles = [...inList[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    else if (single) roles = [single[1]];
    if (!roles.length) continue;
    // granted permission(s)
    let granted: 'all' | Set<string>;
    if (/cross\s+join\s+core\.permissions/.test(stmt)) granted = 'all';
    else {
      const pIn = stmt.match(/p\.key\s+in\s*\(([^)]*)\)/);
      const pSingle = stmt.match(/p\.key\s*=\s*'([^']+)'/);
      const keys = pIn
        ? [...pIn[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
        : pSingle
          ? [pSingle[1]]
          : [];
      granted = new Set(keys);
    }
    for (const role of roles) {
      const existing = grants.get(role);
      if (granted === 'all' || existing === 'all') grants.set(role, 'all');
      else {
        const set = (existing as Set<string>) ?? new Set<string>();
        for (const k of granted) set.add(k);
        grants.set(role, set);
      }
    }
  }
  return grants;
}

const seedPerms = parsePermissionRows(seed);
const seedRoleKeys = parseRoleKeys(seed);
const seedGrants = parseGrants(seed);
const catalog = allPermissions();

describe('permission catalogue ↔ seed parity', () => {
  it('every catalogue permission exists in the seed with identical name/description/category', () => {
    for (const p of catalog) {
      const row = seedPerms.get(p.key);
      expect(row, `seed is missing permission "${p.key}"`).toBeDefined();
      expect(row!.name, `name drift for ${p.key}`).toBe(p.name);
      expect(row!.description, `description drift for ${p.key}`).toBe(p.description);
      expect(row!.category, `category drift for ${p.key}`).toBe(p.category);
    }
  });

  it('the seed has no permission absent from the catalogue (no orphans)', () => {
    const catalogKeys = new Set(catalog.map((p) => p.key));
    for (const key of seedPerms.keys()) {
      expect(catalogKeys.has(key), `seed permission "${key}" is not in the catalogue`).toBe(true);
    }
  });

  it('catalogue permission keys are unique', () => {
    const keys = catalog.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('system roles ↔ seed parity', () => {
  it('catalogue role keys match the seeded core.roles', () => {
    expect(new Set(CATALOG_ROLE_KEYS)).toEqual(seedRoleKeys);
  });

  it('each role grants exactly the catalogue-specified permissions', () => {
    for (const role of SYSTEM_ROLES) {
      const seeded = seedGrants.get(role.key);
      expect(seeded, `no grants found in seed for role "${role.key}"`).toBeDefined();
      if (role.grants === 'all') {
        expect(seeded, `role "${role.key}" should be granted all permissions`).toBe('all');
      } else {
        expect(seeded, `role "${role.key}" grants should be an explicit set`).not.toBe('all');
        expect(new Set(seeded as Set<string>)).toEqual(new Set(role.grants));
      }
    }
  });
});

describe('typed UI constants ⊆ catalogue', () => {
  it('PERMISSIONS and CARGO_PERMISSIONS values are real catalogue keys', () => {
    const keys = new Set(catalog.map((p) => p.key));
    for (const v of [...Object.values(PERMISSIONS), ...Object.values(CARGO_PERMISSIONS)]) {
      expect(keys.has(v), `permissions.ts constant "${v}" is not a catalogue permission`).toBe(true);
    }
  });

  it('permissions.ts SYSTEM_ROLE_KEYS matches the catalogue', () => {
    expect(new Set(SYSTEM_ROLE_KEYS)).toEqual(new Set(CATALOG_ROLE_KEYS));
  });
});

describe('module schema isolation', () => {
  it('every module owns a distinct Postgres schema', () => {
    const schemas = moduleSchemas();
    expect(new Set(schemas).size, `module schemas collide: ${schemas.join(', ')}`).toBe(schemas.length);
  });
});
