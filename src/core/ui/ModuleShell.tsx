// ModuleShell — reusable in-module chrome. Sidebar nav on desktop; a sticky
// horizontal scrolling nav on mobile (CSS-only, no fragile JS drawer). Navigation
// is built from the module manifest, filtered by the user's permissions.
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

  const items = navForUser(moduleKey, ctx.permissions);

  // Preserve manifest order while grouping by optional group label.
  const groups: { label: string; items: typeof items }[] = [];
  for (const item of items) {
    const label = item.group ?? '';
    let g = groups.find((x) => x.label === label);
    if (!g) {
      g = { label, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }

  return (
    <div className="module-shell">
      <aside className="module-aside">
        <div className="module-title">{mod.name}</div>
        <nav className="module-nav">
          {groups.map((group) => (
            <div key={group.label || '_'} style={{ display: 'contents' }}>
              {group.label ? <div className="nav-group-label">{group.label}</div> : null}
              {group.items.map((item) => (
                <Link
                  key={item.key}
                  href={(item.path ? `${mod.route}/${item.path}` : mod.route) as Route}
                  className="nav-link"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="module-main">{children}</main>
    </div>
  );
}
