import { ModuleEmptyState } from '@/core/ui';

export default function CargoAssuranceHome() {
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Cargo Assurance</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Portfolio Overview</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 620 }}>
            Periodic liquid-cargo measurement, reconciliation and loss assurance — organized around an
            Assurance Review covering a 6- or 12-month period, not individual daily loadouts.
          </p>
        </div>
      </div>
      <ModuleEmptyState
        title="No assurance reviews yet"
        description="Create an Assurance Review, then bulk-upload the period's certificates and reports. The system extracts and reconstructs each loadout, applies client and Taylor-corrected reconciliation (in volume or mass), and aggregates the results across the whole period."
        actions={[{ label: 'Assurance Reviews', href: '/cargo-assurance/reviews' }]}
      />
    </div>
  );
}
