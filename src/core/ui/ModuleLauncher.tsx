// Module launcher — the platform home. Renders the modules enabled for the active
// company (super admins see all non-archived modules), driven entirely by the
// module registry. Adding a module to the registry makes it appear here.
import Link from 'next/link';
import type { Route } from 'next';
import { visibleModules } from '@/core/modules';
import type { PlatformContext } from '@/core/session/types';

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  live: { label: 'Live', color: '#065f46', bg: '#d1fae5' },
  beta: { label: 'Beta', color: '#92400e', bg: '#fef3c7' },
  planned: { label: 'Planned', color: '#475569', bg: '#e2e8f0' },
  archived: { label: 'Archived', color: '#475569', bg: '#e2e8f0' },
};

export function ModuleLauncher({ ctx }: { ctx: PlatformContext }) {
  const modules = visibleModules(ctx.enabledModuleKeys, ctx.isSuperAdmin);

  return (
    <section>
      <h1 style={{ fontSize: '1.6rem', margin: '0 0 0.25rem' }}>Modules</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 1.5rem' }}>
        Select a module to open. Availability is per company and per your role.
      </p>

      {modules.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>
          No modules are enabled for this company yet. A company administrator can enable modules in
          Administration.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {modules.map((m) => {
            const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE.planned;
            const openable = m.status !== 'planned' && m.status !== 'archived';
            const card = (
              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: 18,
                  background: '#fff',
                  height: '100%',
                  opacity: openable ? 1 : 0.6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <strong style={{ fontSize: '1.05rem' }}>{m.name}</strong>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: badge.color,
                      background: badge.bg,
                      padding: '2px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {badge.label}
                  </span>
                </div>
                <p style={{ color: 'var(--muted)', fontSize: 14, margin: '8px 0 0' }}>{m.tagline}</p>
              </div>
            );
            return openable ? (
              <Link key={m.key} href={m.route as Route} style={{ textDecoration: 'none', color: 'inherit' }}>
                {card}
              </Link>
            ) : (
              <div key={m.key}>{card}</div>
            );
          })}
        </div>
      )}
    </section>
  );
}
