// ModuleNav — the in-module sidebar navigation. Section headers (Ledger, Receivables,
// …) are clickable, collapsible groups with a rotating chevron. By default only the
// section containing the current page is open; the user's manual toggles are then
// remembered per module (localStorage). On mobile the groups flatten into the existing
// horizontal scroll row (toggles hidden, all links shown) so nothing is hidden there.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

interface NavLeaf {
  key: string;
  label: string;
  href: string;
}
export interface NavGroup {
  label: string;
  items: NavLeaf[];
}

export function ModuleNav({
  route,
  storageKey,
  ungrouped,
  groups,
}: {
  route: string;
  storageKey: string;
  ungrouped: NavLeaf[];
  groups: NavGroup[];
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || (href !== route && pathname.startsWith(href + '/'));

  const activeGroupLabel =
    groups.find((g) => g.items.some((i) => isActive(i.href)))?.label ?? null;

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) init[g.label] = g.label === activeGroupLabel;
    return init;
  });

  // After hydration, fold in remembered toggles; always keep the active section open.
  useEffect(() => {
    let stored: Record<string, boolean> | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
    setOpen((prev) => {
      const next = { ...prev };
      if (stored) {
        for (const g of groups) if (g.label in stored!) next[g.label] = stored![g.label];
      }
      if (activeGroupLabel) next[activeGroupLabel] = true;
      return next;
    });
    // re-evaluate when the route changes so the new active section expands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggle = (label: string) =>
    setOpen((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  return (
    <nav className="module-nav">
      {ungrouped.map((item) => (
        <Link
          key={item.key}
          href={item.href as Route}
          className="nav-link"
          aria-current={isActive(item.href) ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}

      {groups.map((group) => {
        const isOpen = open[group.label] ?? false;
        const panelId = `navgrp-${group.label.replace(/\s+/g, '-').toLowerCase()}`;
        return (
          <div key={group.label} className="nav-group" data-open={isOpen}>
            <button
              type="button"
              className="nav-group-toggle"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(group.label)}
            >
              <span>{group.label}</span>
              <svg className="nav-group-chevron" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path
                  d="M6 4l4 4-4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="nav-group-items" id={panelId}>
              {group.items.map((item) => (
                <Link
                  key={item.key}
                  href={item.href as Route}
                  className="nav-link"
                  aria-current={isActive(item.href) ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
