// Provider registry. Resolves a provider id to a concrete adapter using server-only
// env keys. Five providers ship as presets — Anthropic (native) plus OpenAI, DeepSeek,
// Gemini and GLM/Z.ai over the one OpenAI-compatible adapter. Each base URL is
// env-overridable, so any other OpenAI-compatible endpoint (Groq, Together, OpenRouter,
// local Ollama) works by pointing an existing id at a new base. Unknown/unconfigured
// ids resolve to the NoopProvider, keeping AI dormant until a key is set.
import 'server-only';
import type { AIProvider } from './types';
import { NoopProvider } from './providers/noop';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAICompatibleProvider } from './providers/openai-compatible';

export interface ProviderMeta { id: string; label: string; defaultBaseUrl?: string }

export const PROVIDERS: ProviderMeta[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com' },
  { id: 'gemini', label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'glm', label: 'GLM (Z.ai)', defaultBaseUrl: 'https://api.z.ai/api/paas/v4' },
];

const env = (k: string) => process.env[k];

export function getAIProvider(id: string): AIProvider {
  switch (id) {
    case 'anthropic':
      return new AnthropicProvider(env('AI_ANTHROPIC_API_KEY'));
    case 'openai':
      return new OpenAICompatibleProvider({ id, apiKey: env('AI_OPENAI_API_KEY'), baseUrl: env('AI_OPENAI_BASE_URL') ?? 'https://api.openai.com/v1' });
    case 'deepseek':
      return new OpenAICompatibleProvider({ id, apiKey: env('AI_DEEPSEEK_API_KEY'), baseUrl: env('AI_DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com' });
    case 'gemini':
      return new OpenAICompatibleProvider({ id, apiKey: env('AI_GEMINI_API_KEY'), baseUrl: env('AI_GEMINI_BASE_URL') ?? 'https://generativelanguage.googleapis.com/v1beta/openai' });
    case 'glm':
      return new OpenAICompatibleProvider({ id, apiKey: env('AI_GLM_API_KEY'), baseUrl: env('AI_GLM_BASE_URL') ?? 'https://api.z.ai/api/paas/v4' });
    default:
      return new NoopProvider(id);
  }
}

/** For the settings UI: which providers currently have a key configured (server-side). */
export function providerStatus(): { id: string; label: string; configured: boolean }[] {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.label, configured: getAIProvider(p.id).configured }));
}
