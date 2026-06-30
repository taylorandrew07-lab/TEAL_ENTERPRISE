// AI configuration screen: per-task model + mode, prompt templates, provider status,
// and a live connection test. Provider-agnostic — pick any configured provider/model
// per task. Everything stays dormant until a provider key is set in the server env.
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AI_JOB_TYPES, TIER_LABELS, MODE_LABELS, type AITier, type AIMode } from './tiers';
import { upsertTaskSetting, savePrompt, installDefaultPrompts, testProviderConnection } from './settings-actions';
import type { PromptRow } from './queries';

export interface TaskConfigView { jobType: string; mode: AIMode; tier: AITier; provider: string; model: string }
export interface ProviderStatus { id: string; label: string; configured: boolean }

const TIERS: AITier[] = ['cheap', 'standard', 'premium'];
const MODES: AIMode[] = ['off', 'suggest', 'auto'];

export function AiSettings({ providers, tasks, prompts }: { providers: ProviderStatus[]; tasks: TaskConfigView[]; prompts: PromptRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [state, setState] = useState<Record<string, TaskConfigView>>(() => Object.fromEntries(tasks.map((t) => [t.jobType, t])));
  const [test, setTest] = useState({ provider: providers[0]?.id ?? 'openai', model: '' });

  const label = (k: string) => AI_JOB_TYPES.find((t) => t.key === k)?.label ?? k;
  const run = (fn: () => Promise<{ ok: boolean; error?: string; text?: string }>, okMsg: string) => {
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setNotice({ kind: 'err', msg: r.error ?? 'Failed' });
      else { setNotice({ kind: 'ok', msg: r.text ? `${okMsg}: ${r.text}` : okMsg }); router.refresh(); }
    });
  };

  const saveTask = (jt: string) => {
    const c = state[jt];
    const fd = new FormData();
    fd.set('job_type', jt); fd.set('mode', c.mode); fd.set('tier', c.tier);
    fd.set('provider', c.provider ?? ''); fd.set('model', c.model ?? '');
    run(() => upsertTaskSetting(fd), `Saved ${label(jt)}`);
  };
  const set = (jt: string, patch: Partial<TaskConfigView>) => setState((s) => ({ ...s, [jt]: { ...s[jt], ...patch } }));

  return (
    <div>
      {notice ? (
        <div role="status" style={{ background: notice.kind === 'ok' ? 'var(--success-weak)' : 'var(--danger-weak)', color: notice.kind === 'ok' ? 'var(--success)' : 'var(--danger)', border: `1px solid ${notice.kind === 'ok' ? 'oklch(0.82 0.08 150)' : 'oklch(0.85 0.06 25)'}`, padding: '9px 12px', borderRadius: 'var(--r)', fontSize: 'var(--text-sm)', marginBottom: 14 }}>{notice.msg}</div>
      ) : null}

      {/* Providers */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>Providers</h2>
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {providers.map((p) => (
              <span key={p.id} className={`badge ${p.configured ? 'badge-success' : 'badge-neutral'}`}>{p.label}{p.configured ? ' · ready' : ' · no key'}</span>
            ))}
          </div>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 'var(--text-sm)' }}>
            Add a provider by setting its server env key (e.g. <code>AI_OPENAI_API_KEY</code>, <code>AI_ANTHROPIC_API_KEY</code>, <code>AI_DEEPSEEK_API_KEY</code>, <code>AI_GEMINI_API_KEY</code>, <code>AI_GLM_API_KEY</code>). Until then AI stays off.
          </p>
          <div className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <div className="field"><label className="label">Provider</label>
              <select className="input" value={test.provider} onChange={(e) => setTest({ ...test, provider: e.target.value })}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="field"><label className="label">Model</label>
              <input className="input" placeholder="e.g. gpt-4o-mini" value={test.model} onChange={(e) => setTest({ ...test, model: e.target.value })} />
            </div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => { const fd = new FormData(); fd.set('provider', test.provider); fd.set('model', test.model); run(() => testProviderConnection(fd), 'Connection OK'); }}>Test connection</button>
          </div>
        </div>
      </section>

      {/* Per-task config */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 10px' }}>AI tasks</h2>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 'var(--text-sm)' }}>Pick the model tier (and optionally an exact provider/model) per task. Leave provider/model blank to use the tier default. <strong>Off</strong> = humans only.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Task</th><th style={{ width: 190 }}>Mode</th><th style={{ width: 130 }}>Tier</th><th style={{ width: 130 }}>Provider</th><th style={{ width: 150 }}>Model</th><th style={{ width: 90 }} /></tr></thead>
            <tbody>
              {AI_JOB_TYPES.map((t) => {
                const c = state[t.key];
                if (!c) return null;
                return (
                  <tr key={t.key}>
                    <td><div style={{ fontWeight: 600 }}>{t.label}</div><div className="muted" style={{ fontSize: 'var(--text-xs)' }}>{t.description}</div></td>
                    <td><select className="input" value={c.mode} onChange={(e) => set(t.key, { mode: e.target.value as AIMode })}>{MODES.map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}</select></td>
                    <td><select className="input" value={c.tier} onChange={(e) => set(t.key, { tier: e.target.value as AITier })}>{TIERS.map((x) => <option key={x} value={x}>{TIER_LABELS[x]}</option>)}</select></td>
                    <td><input className="input" placeholder="default" value={c.provider ?? ''} onChange={(e) => set(t.key, { provider: e.target.value })} /></td>
                    <td><input className="input" placeholder="default" value={c.model ?? ''} onChange={(e) => set(t.key, { model: e.target.value })} /></td>
                    <td><button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => saveTask(t.key)}>Save</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Prompts */}
      <section>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h2 style={{ fontSize: 'var(--text-lg)', margin: 0 }}>Prompt templates</h2>
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => installDefaultPrompts(), 'Default prompts installed')}>Install defaults</button>
        </div>
        {prompts.length === 0 ? (
          <div className="card" style={{ padding: 18 }}><p className="muted" style={{ margin: 0 }}>No prompts yet. Click <strong>Install defaults</strong> to add editable starter templates.</p></div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {prompts.map((p) => <PromptEditor key={p.id} prompt={p} pending={pending} onSave={(fd) => run(() => savePrompt(fd), `Saved prompt ${p.key}`)} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function PromptEditor({ prompt, pending, onSave }: { prompt: PromptRow; pending: boolean; onSave: (fd: FormData) => void }) {
  const [template, setTemplate] = useState(prompt.template);
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <strong>{prompt.name} <span className="muted" style={{ fontWeight: 400, fontSize: 'var(--text-sm)' }}>· {prompt.key} v{prompt.version}</span></strong>
      </div>
      <textarea className="input" rows={5} value={template} onChange={(e) => setTemplate(e.target.value)} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-sm)' }} />
      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => { const fd = new FormData(); fd.set('key', prompt.key); fd.set('name', prompt.name); fd.set('template', template); onSave(fd); }}>Save new version</button>
      </div>
    </div>
  );
}
