// ModuleNav — the in-module sidebar navigation. Section headers (Ledger, Receivables,
// …) are clickable collapsible groups with a rotating chevron; only the section for the
// current page is open by default, and manual toggles are remembered per module.
//
// CUSTOMIZE: a "Customize" button at the bottom enters an edit mode where you drag to
// reorder the section bars and the links within them. The chosen order is remembered per
// module (localStorage) and applied on every visit. On mobile the groups flatten into the
// horizontal scroll row and customizing is disabled.
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

interface NavOrder {
  groups: string[];
  items: Record<string, string[]>;
  ungrouped: string[];
}

const UNGROUPED = '__ungrouped__';

function reorder<T>(items: T[], saved: string[] | undefined, keyOf: (t: T) => string): T[] {
  if (!saved || saved.length === 0) return items;
  const byKey = new Map(items.map((i) => [keyOf(i), i] as const));
  const out: T[] = [];
  for (const k of saved) {
    const it = byKey.get(k);
    if (it) {
      out.push(it);
      byKey.delete(k);
    }
  }
  for (const i of items) if (byKey.has(keyOf(i))) out.push(i); // new items appended
  return out;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from === to) return arr;
  const copy = arr.slice();
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x);
  return copy;
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
  const orderKey = `${storageKey}:order`;

  const isActive = (href: string) => pathname === href || (href !== route && pathname.startsWith(href + '/'));
  const activeGroupLabel = groups.find((g) => g.items.some((i) => isActive(i.href)))?.label ?? null;

  const [order, setOrder] = useState<NavOrder>({ groups: [], items: {}, ungrouped: [] });
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<{ type: 'group'; label: string } | { type: 'item'; group: string; key: string } | null>(null);

  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) init[g.label] = g.label === activeGroupLabel;
    return init;
  });

  // Load saved order + collapse state after hydration.
  useEffect(() => {
    try {
      const rawOrder = localStorage.getItem(orderKey);
      if (rawOrder) setOrder(JSON.parse(rawOrder));
    } catch {
      /* ignore */
    }
    let stored: Record<string, boolean> | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
    setOpen((prev) => {
      const next = { ...prev };
      if (stored) for (const g of groups) if (g.label in stored!) next[g.label] = stored![g.label];
      if (activeGroupLabel) next[activeGroupLabel] = true;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const persist = (next: NavOrder) => {
    setOrder(next);
    try {
      localStorage.setItem(orderKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

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

  // Apply the saved order.
  const orderedUngrouped = reorder(ungrouped, order.ungrouped, (i) => i.key);
  const orderedGroups = reorder(groups, order.groups, (g) => g.label).map((g) => ({
    ...g,
    items: reorder(g.items, order.items[g.label], (i) => i.key),
  }));

  // --- drag handlers ---
  const onGroupDrop = (targetLabel: string) => {
    if (!drag || drag.type !== 'group') return;
    const labels = orderedGroups.map((g) => g.label);
    persist({ ...order, groups: move(labels, labels.indexOf(drag.label), labels.indexOf(targetLabel)) });
  };
  const onItemDrop = (groupKey: string, items: NavLeaf[], targetKey: string) => {
    if (!drag || drag.type !== 'item' || drag.group !== groupKey) return; // within-group only
    const keys = items.map((i) => i.key);
    const next = move(keys, keys.indexOf(drag.key), keys.indexOf(targetKey));
    if (groupKey === UNGROUPED) persist({ ...order, ungrouped: next });
    else persist({ ...order, items: { ...order.items, [groupKey]: next } });
  };

  const reset = () => {
    try {
      localStorage.removeItem(orderKey);
    } catch {
      /* ignore */
    }
    setOrder({ groups: [], items: {}, ungrouped: [] });
  };

  const allowDrop = (e: React.DragEvent) => {
    if (editing) e.preventDefault();
  };

  function renderItem(item: NavLeaf, groupKey: string, items: NavLeaf[]) {
    if (editing) {
      return (
        <div
          key={item.key}
          className="nav-link nav-edit-item"
          draggable
          onDragStart={() => setDrag({ type: 'item', group: groupKey, key: item.key })}
          onDragOver={allowDrop}
          onDrop={() => onItemDrop(groupKey, items, item.key)}
          onDragEnd={() => setDrag(null)}
        >
          <span className="nav-grip" aria-hidden="true">⠿</span>
          {item.label}
        </div>
      );
    }
    return (
      <Link key={item.key} href={item.href as Route} className="nav-link" aria-current={isActive(item.href) ? 'page' : undefined}>
        {item.label}
      </Link>
    );
  }

  return (
    <nav className="module-nav">
      {/* ungrouped items (e.g. Dashboard) */}
      {orderedUngrouped.map((item) => renderItem(item, UNGROUPED, orderedUngrouped))}

      {orderedGroups.map((group) => {
        const isOpen = editing || (open[group.label] ?? false);
        const panelId = `navgrp-${group.label.replace(/\s+/g, '-').toLowerCase()}`;
        return (
          <div
            key={group.label}
            className="nav-group"
            data-open={isOpen}
            data-editing={editing || undefined}
            draggable={editing}
            onDragStart={(e) => {
              if (!editing) return;
              e.stopPropagation();
              setDrag({ type: 'group', label: group.label });
            }}
            onDragOver={allowDrop}
            onDrop={(e) => {
              if (!editing) return;
              e.stopPropagation();
              onGroupDrop(group.label);
            }}
            onDragEnd={() => setDrag(null)}
          >
            {editing ? (
              <div className="nav-group-toggle nav-edit-group">
                <span className="nav-grip" aria-hidden="true">⠿</span>
                <span>{group.label}</span>
              </div>
            ) : (
              <button type="button" className="nav-group-toggle" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(group.label)}>
                <span>{group.label}</span>
                <svg className="nav-group-chevron" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                  <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <div className="nav-group-items" id={panelId}>
              {group.items.map((item) => renderItem(item, group.label, group.items))}
            </div>
          </div>
        );
      })}

      <div className="module-customize">
        {editing ? (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing(false)}>Done</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Reset</button>
          </>
        ) : (
          <button type="button" className="nav-customize-btn" onClick={() => setEditing(true)}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path d="M2 4h7M2 8h12M2 12h5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="11" cy="4" r="1.6" fill="currentColor" />
              <circle cx="9" cy="12" r="1.6" fill="currentColor" />
            </svg>
            Customize
          </button>
        )}
      </div>
      {editing ? <p className="nav-edit-hint">Drag the sections and links to rearrange.</p> : null}
    </nav>
  );
}
