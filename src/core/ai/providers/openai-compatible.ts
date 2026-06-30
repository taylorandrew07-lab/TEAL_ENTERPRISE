// OpenAI-compatible adapter (Chat Completions API over fetch — no SDK). One adapter
// reaches OpenAI, DeepSeek, Google Gemini (its OpenAI-compatible endpoint), Z.ai GLM,
// and others (Groq/Together/OpenRouter/Ollama) — each is just a different baseUrl +
// key + model registered in the registry.
import 'server-only';
import type { AIProvider, AIRequest, AIResult, AIToolCall } from '../types';

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(opts: { id: string; apiKey: string | undefined; baseUrl: string }) {
    this.id = opts.id;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }
  get configured(): boolean { return Boolean(this.apiKey); }

  async complete(req: AIRequest): Promise<AIResult> {
    if (!this.apiKey) return { text: null, toolCalls: [], model: req.model, finishReason: 'not_configured' };

    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages) messages.push({ role: m.role === 'tool' ? 'user' : m.role, content: m.content });

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.2,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      if (req.toolChoice === 'auto' || req.toolChoice === 'none' || req.toolChoice === 'required') body.tool_choice = req.toolChoice;
      else if (req.toolChoice && typeof req.toolChoice === 'object') body.tool_choice = { type: 'function', function: { name: req.toolChoice.name } };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${this.id} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const msg = json.choices?.[0]?.message ?? {};
    const toolCalls: AIToolCall[] = (msg.tool_calls ?? []).map((tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id, name: tc.function?.name, arguments: safeParse(tc.function?.arguments),
    }));
    return {
      text: msg.content ?? null,
      toolCalls,
      usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens },
      model: json.model ?? req.model,
      finishReason: json.choices?.[0]?.finish_reason,
    };
  }

  async generateStructured<T>(req: AIRequest, schema: Record<string, unknown>): Promise<{ data: T | null; raw: AIResult }> {
    const raw = await this.complete({
      ...req,
      tools: [{ name: 'respond', description: 'Return the result as structured JSON matching the schema.', parameters: schema }],
      toolChoice: { name: 'respond' },
    });
    const call = raw.toolCalls.find((c) => c.name === 'respond');
    return { data: (call?.arguments as T) ?? null, raw };
  }
}

function safeParse(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
