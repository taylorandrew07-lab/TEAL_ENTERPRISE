// ModuleShell — reusable in-module chrome. Collapsible grouped sidebar nav on desktop
// (see ModuleNav); a sticky horizontal scrolling nav on mobile. Navigation is built
// from the module manifest, filtered by the user's permissions, then handed to the
// client ModuleNav for the collapse/expand interaction.
import { getModule, navForUser } from '@/core/modules';
import type { PlatformContext } from '@/core/session/types';
import { ModuleNav, type NavGroup } from './ModuleNav';

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
  const hrefOf = (path?: string) => (path ? `${mod.route}/${path}` : mod.route);

  // Ungrouped items (e.g. Dashboard) render as plain links above the groups.
  const ungrouped = items
    .filter((i) => !i.group)
    .map((i) => ({ key: i.key, label: i.label, href: hrefOf(i.path) }));

  // Preserve manifest order while grouping by group label.
  const groups: NavGroup[] = [];
  for (const item of items) {
    if (!item.group) continue;
    let g = groups.find((x) => x.label === item.group);
    if (!g) {
      g = { label: item.group, items: [] };
      groups.push(g);
    }
    g.items.push({ key: item.key, label: item.label, href: hrefOf(item.path) });
  }

  return (
    <div className="module-shell">
      <aside className="module-aside">
        <div className="module-title">{mod.name}</div>
        <ModuleNav
          route={mod.route}
          storageKey={`teal-nav:${moduleKey}`}
          ungrouped={ungrouped}
          groups={groups}
        />
      </aside>
      <main className="module-main">{children}</main>
    </div>
  );
}
