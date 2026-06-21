// AdminNav — sidebar navigation for the platform Administration area. Mirrors the
// module sidebar styling (.module-nav / .nav-link) and highlights the active route.
// Items are supplied by the layout, already filtered to what the user may access.
'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

export interface AdminNavItem {
  href: string;
  label: string;
  exact?: boolean;
}

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="module-nav">
      {items.map((it) => {
        const active = it.exact
          ? pathname === it.href
          : pathname === it.href || pathname.startsWith(it.href + '/');
        return (
          <Link
            key={it.href}
            href={it.href as Route}
            className="nav-link"
            aria-current={active ? 'page' : undefined}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
