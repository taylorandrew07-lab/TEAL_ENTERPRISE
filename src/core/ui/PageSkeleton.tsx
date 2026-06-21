// PageSkeleton — instant content placeholder shown via a Next route loading.tsx while
// a module page's server data resolves. The persistent ModuleShell (header + sidebar)
// stays in place; only this main-content area shimmers, so navigation feels immediate
// instead of pausing on a blank screen.
export function PageSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div>
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="skeleton" style={{ width: 84, height: 11, borderRadius: 6 }} />
          <div className="skeleton" style={{ width: 220, height: 26, marginTop: 12, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: 300, height: 12, marginTop: 12, borderRadius: 6 }} />
        </div>
        <div className="skeleton" style={{ width: 132, height: 38, borderRadius: 9 }} />
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="row"
            style={{
              justifyContent: 'space-between',
              gap: 16,
              padding: '14px 16px',
              borderBottom: i < rows - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div className="skeleton" style={{ width: '38%', height: 12, borderRadius: 6 }} />
            <div className="skeleton" style={{ width: '16%', height: 12, borderRadius: 6 }} />
            <div className="skeleton" style={{ width: '10%', height: 12, borderRadius: 6 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
