// AdminNav — sidebar navigation for the platform Administration area. Mirrors the
// module sidebar styling (.module-nav / .nav-link) and highlights the active route.
'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

const ITEMS: { href: Route; label: string; exact?: boolean }[] = [
  { href: '/admin' as Route, label: 'Overview', exact: true },
  { href: '/admin/companies' as Route, label: 'Companies' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="module-nav">
      {ITEMS.map((it) => {
        const active = it.exact
          ? pathname === it.href
          : pathname === it.href || pathname.startsWith(it.href + '/');
        return (
          <Link
            key={it.href}
            href={it.href}
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
