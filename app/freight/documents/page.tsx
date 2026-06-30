import { requireModule } from '@/core/session/guard';
import { ModuleEmptyState } from '@/core/ui';

export const metadata = { title: 'Documents — Jupiter Logistics' };

export default async function DocumentsPage() {
  await requireModule('freight', 'freight.documents.manage');
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jupiter Logistics</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Documents</h1>
        </div>
      </div>
      <ModuleEmptyState
        title="Document library — next build"
        description="Upload and generate shipment documents (B/L, commercial invoice, packing list, arrival notice, delivery order, POD, certificates and more), each permanently linked to its shipment. Files use the platform's existing secure document store; the freight library view lands next."
        actions={[{ label: 'Back to shipments', href: '/freight/shipments', primary: false }]}
      />
    </div>
  );
}
