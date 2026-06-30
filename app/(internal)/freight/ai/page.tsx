import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { listAwaitingAiJobs, listRecentAiJobs } from '@/modules/freight/ai/queries';
import { AiInbox } from '@/modules/freight/ai/AiInbox';

export const metadata = { title: 'AI — Jupiter Logistics' };

export default async function FreightAiPage() {
  await requireModule('freight', 'freight.ai.manage');
  const [awaiting, recent] = await Promise.all([listAwaitingAiJobs(), listRecentAiJobs()]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jupiter Logistics</div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>AI</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 680 }}>
            The AI assistant proposes actions; a human approves before anything is saved or sent. Configure
            providers, models and which tasks are enabled in <Link href="/freight/settings/ai">AI settings</Link>.
          </p>
        </div>
      </div>
      <AiInbox awaiting={awaiting} recent={recent} />
    </div>
  );
}
