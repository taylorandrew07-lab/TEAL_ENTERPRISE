import Link from 'next/link';
import { requireModule } from '@/core/session/guard';
import { providerStatus } from '@/core/ai';
import { listTaskConfigs } from '@/modules/freight/ai/config';
import { listPrompts } from '@/modules/freight/ai/queries';
import { AiSettings } from '@/modules/freight/ai/AiSettings';

export const metadata = { title: 'AI settings — Jupiter Logistics' };

export default async function FreightAiSettings() {
  await requireModule('freight', 'freight.ai.manage');
  const [tasks, prompts] = await Promise.all([listTaskConfigs(), listPrompts()]);
  const providers = providerStatus();
  const taskViews = tasks.map((t) => ({ jobType: t.jobType, mode: t.mode, tier: t.tier, provider: t.provider, model: t.model }));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/freight/settings">Settings</Link></div>
          <h1 style={{ fontSize: 'var(--text-2xl)', marginTop: 6 }}>AI settings</h1>
          <p className="muted" style={{ margin: '4px 0 0', maxWidth: 720 }}>
            Provider-agnostic: use any model for any task. Cheap models handle simple work (summaries, extraction);
            premium models are reserved for hard reasoning. Nothing runs until a provider key is set and a task is
            switched on.
          </p>
        </div>
      </div>
      <AiSettings providers={providers} tasks={taskViews} prompts={prompts} />
    </div>
  );
}
