// Module launcher — the platform home. Renders the modules available to the active
// company + user, driven entirely by the registry. Adding a module to the registry
// makes it appear here automatically.
import Link from 'next/link';
import type { Route } from 'next';
import { visibleModules } from '@/core/modules';
import { can, type PlatformContext } from '@/core/session/types';
import './module-launcher.css';

const STATUS: Record<string, { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'badge-success' },
  beta: { label: 'Beta', cls: 'badge-brand' },
  planned: { label: 'Planned', cls: 'badge-neutral' },
  archived: { label: 'Archived', cls: 'badge-neutral' },
};

export function ModuleLauncher({ ctx }: { ctx: PlatformContext }) {
  const modules = visibleModules(ctx.enabledModuleKeys, ctx.isSuperAdmin, can(ctx, 'platform.beta'));
  const company = ctx.companies.find((c) => c.id === ctx.activeCompanyId);

  return (
    <main className="launcher">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Modules</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {company ? `${company.name} · ` : ''}Select a module to open. Availability follows your role.
          </p>
        </div>
      </div>

      {modules.length === 0 ? (
        <div className="card" style={{ padding: 28, maxWidth: 560 }}>
          <p className="muted" style={{ margin: 0 }}>
            No modules are enabled for this company yet. An administrator can enable modules in Administration.
          </p>
        </div>
      ) : (
        <div className="launcher-grid">
          {modules.map((m, i) => {
            const badge = STATUS[m.status] ?? STATUS.planned;
            const openable = m.status !== 'planned' && m.status !== 'archived';
            const mark = m.name.replace(/^TEAL\s+/i, '').trim().charAt(0).toUpperCase();
            const inner = (
              <div className="module-tile" data-open={openable} style={{ animationDelay: `${i * 45}ms` }}>
                <div className="module-tile-top">
                  <span className="module-tile-mark">{mark}</span>
                  <span className={`badge ${badge.cls}`}>{badge.label}</span>
                </div>
                <div className="module-tile-name">{m.name}</div>
                <p className="module-tile-tag">{m.tagline}</p>
                {openable ? <span className="module-tile-cta">Open →</span> : null}
              </div>
            );
            return openable ? (
              <Link key={m.key} href={m.route as Route} className="module-tile-link">
                {inner}
              </Link>
            ) : (
              <div key={m.key}>{inner}</div>
            );
          })}
        </div>
      )}
    </main>
  );
}
