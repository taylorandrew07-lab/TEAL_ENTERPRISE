import { requireModule } from '@/core/session/guard';
import { ModuleEmptyState } from '@/core/ui';

export const metadata = { title: 'Settings — Jupiter Logistics' };

export default async function FreightSettingsPage() {
  await requireModule('freight', 'freight.comms.manage');
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jupiter Logistics</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>Settings</h1>
        </div>
      </div>
      <ModuleEmptyState
        title="Module settings — next build"
        description="Connect Microsoft 365 mailboxes (multiple shared inboxes supported), manage charge codes, set the shipment reference prefix and default Incoterm/currency, and — when you switch it on — configure AI prompts and which steps the AI may perform. The data model for all of this is already in place."
        actions={[{ label: 'Back to dashboard', href: '/freight', primary: false }]}
      />
    </div>
  );
}
