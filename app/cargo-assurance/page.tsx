import { ModuleEmptyState } from '@/core/ui';

export default function CargoAssuranceHome() {
  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', margin: '0 0 4px' }}>TEAL Cargo Assurance</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 24px' }}>
        Periodic liquid-cargo measurement, reconciliation and loss assurance. Work is organized
        around an Assurance Review covering a 6- or 12-month period — not individual daily loadouts.
      </p>
      <ModuleEmptyState
        title="No assurance reviews yet"
        description="Create an Assurance Review, then bulk-upload the period's certificates and reports. The system extracts and reconstructs each loadout, applies client and Taylor-corrected reconciliation (in volume or mass), and aggregates the results across the whole period."
        actions={[{ label: 'Assurance Reviews', href: '/cargo-assurance/reviews' }]}
      />
    </div>
  );
}
