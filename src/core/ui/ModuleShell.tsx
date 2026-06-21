// ModuleShell — the reusable in-module chrome every module renders inside.
// It builds the sidebar from the module's manifest navigation, filtered by the
// user's permissions (UI gate; RLS remains authoritative). A module's layout
// only has to supply its key and the children — navigation comes from the registry.
import Link from 'next/link';
import type { Route } from 'next';
import { getModule, navForUser } from '@/core/modules';
import type { PlatformContext } from '@/core/session/types';

export function ModuleShell({
  moduleKey,
  ctx,
  children,
}: {
  moduleKey: string;
  ctx: PlatformContext;
  children: React.ReactNode;
}) {
  const mod = getModule(moduleKey);
  if (!mod) return <>{children}</>;

  // Super admins receive every permission key in ctx.permissions, so this filter
  // shows them the full module navigation without special-casing here.
  const items = navForUser(moduleKey, ctx.permissions);

  // Group nav items by their optional group label, preserving order.
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const g = item.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(item);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: 'calc(100vh - 57px)' }}>
      <aside style={{ borderRight: '1px solid #e2e8f0', background: '#fff', padding: '16px 12px' }}>
        <div style={{ padding: '4px 8px 12px', fontWeight: 700 }}>{mod.name}</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[...groups.entries()].map(([group, groupItems]) => (
            <div key={group || '_'} style={{ marginBottom: 8 }}>
              {group ? (
                <div
                  style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--muted)',
                    padding: '8px 8px 4px',
                  }}
                >
                  {group}
                </div>
              ) : null}
              {groupItems.map((item) => (
                <Link
                  key={item.key}
                  href={(item.path ? `${mod.route}/${item.path}` : mod.route) as Route}
                  style={{
                    display: 'block',
                    padding: '7px 8px',
                    borderRadius: 8,
                    textDecoration: 'none',
                    color: 'var(--ink)',
                    fontSize: 14,
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main style={{ padding: '24px 28px' }}>{children}</main>
    </div>
  );
}
