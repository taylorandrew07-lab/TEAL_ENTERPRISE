// ModuleEmptyState — a real, honest empty state for a module landing screen.
// Used before any data exists for a company. No demo/fake data — it states what
// the module does and what the user can do next based on their permissions.
import Link from 'next/link';
import type { Route } from 'next';

export function ModuleEmptyState({
  title,
  description,
  actions = [],
}: {
  title: string;
  description: string;
  actions?: { label: string; href: string }[];
}) {
  return (
    <div
      style={{
        border: '1px dashed #cbd5e1',
        borderRadius: 12,
        padding: '40px 28px',
        textAlign: 'center',
        background: '#fff',
        maxWidth: 640,
      }}
    >
      <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem' }}>{title}</h2>
      <p style={{ color: 'var(--muted)', margin: '0 auto 20px', maxWidth: 480 }}>{description}</p>
      {actions.length > 0 ? (
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href as Route}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                background: 'var(--teal)',
                color: '#fff',
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
