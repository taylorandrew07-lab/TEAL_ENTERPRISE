// Anthropic (Claude) native adapter — Messages API over fetch (no SDK). Maps Claude's
// content-block + tool_use wire format into the normalised AIResult shape.
import 'server-only';
import type { AIProvider, AIRequest, AIResult, AIToolCall, AIToolChoice } from '../types';

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  private readonly apiKey: string | undefined;
  constructor(apiKey: string | undefined) { this.apiKey = apiKey; }
  get configured(): boolean { return Boolean(this.apiKey); }

  async complete(req: AIRequest): Promise<AIResult> {
    if (!this.apiKey) return { text: null, toolCalls: [], model: req.model, finishReason: 'not_configured' };

    const messages = req.messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.2,
      messages,
    };
    if (req.system) body.system = req.system;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      const tc = mapToolChoice(req.toolChoice);
      if (tc) body.tool_choice = tc;
    }

    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': VERSION },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const blocks: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] = json.content ?? [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('') || null;
    const toolCalls: AIToolCall[] = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id!, name: b.name!, arguments: b.input ?? {} }));
    return {
      text,
      toolCalls,
      usage: { inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens },
      model: json.model ?? req.model,
      finishReason: json.stop_reason,
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

function mapToolChoice(tc: AIToolChoice | undefined): Record<string, unknown> | undefined {
  if (!tc) return undefined;
  if (tc === 'auto') return { type: 'auto' };
  if (tc === 'required') return { type: 'any' };
  if (tc === 'none') return { type: 'none' };
  if (typeof tc === 'object') return { type: 'tool', name: tc.name };
  return undefined;
}
