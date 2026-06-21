import { requireModule } from '@/core/session/guard';
import { listCargoTypes, type CargoType } from '@/modules/cargo-assurance/queries';

export const metadata = { title: 'Cargo Types — TEAL Cargo Assurance' };

const CATEGORY_LABEL: Record<string, string> = {
  petroleum: 'Petroleum',
  chemical: 'Chemical',
  vegetable_oil: 'Vegetable oil',
  other: 'Other',
};

export default async function CargoTypesPage() {
  await requireModule('cargo_assurance', 'cargo.config.manage');
  const types = await listCargoTypes();

  const byCategory = [...new Set(types.map((t) => t.category))].map((category) => ({
    category,
    types: types.filter((t) => t.category === category),
  }));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Cargo Assurance</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Cargo Types</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 640 }}>
            The liquid bulk cargoes the module measures. Default densities are illustrative (at 15&deg;C); a
            parcel&apos;s real density always comes from its certificate.
          </p>
        </div>
      </div>

      <div className="table-wrap" style={{ maxWidth: 640 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Cargo type</th>
              <th className="num" style={{ width: 200 }}>Default density (kg/m³ @ 15°C)</th>
            </tr>
          </thead>
          {byCategory.map((g) => (
            <tbody key={g.category}>
              <tr>
                <td colSpan={2} style={{ background: 'var(--surface-2)', fontWeight: 650, color: 'var(--ink-2)' }}>
                  {CATEGORY_LABEL[g.category] ?? g.category}
                </td>
              </tr>
              {g.types.map((t: CargoType) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td className="num">{t.default_density_kg_m3 ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
