// ModuleEmptyState — a real, honest empty state for a module landing screen.
// Used before any data exists. No demo data — states what the screen does and the
// next action(s) based on the user's permissions.
import Link from 'next/link';
import type { Route } from 'next';

export function ModuleEmptyState({
  title,
  description,
  actions = [],
}: {
  title: string;
  description: string;
  actions?: { label: string; href: string; primary?: boolean }[];
}) {
  return (
    <div
      style={{
        border: '1px dashed var(--border-strong)',
        borderRadius: 'var(--r-lg)',
        padding: '40px 28px',
        background: 'var(--surface)',
        maxWidth: 640,
      }}
    >
      <h2 style={{ margin: '0 0 8px', fontSize: 'var(--text-lg)' }}>{title}</h2>
      <p className="muted" style={{ margin: '0 0 20px', maxWidth: 480, lineHeight: 1.55 }}>
        {description}
      </p>
      {actions.length > 0 ? (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href as Route}
              className={`btn ${a.primary === false ? 'btn-ghost' : 'btn-primary'}`}
            >
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
