// Provider-agnostic AI interface. The shared layer NEVER imports a vendor SDK; each
// adapter (Anthropic native, OpenAI-compatible) maps its vendor wire-format into
// these normalised shapes, so the rest of the app is model- and vendor-independent.
// Nothing here calls a network — adapters do, and only when a key is configured.
import 'server-only';

export type AIRole = 'system' | 'user' | 'assistant' | 'tool';
export interface AIMessage {
  role: AIRole;
  content: string;
  toolCallId?: string; // for role:'tool' replies
  name?: string;
}

/** A tool the model may call. `parameters` is a JSON Schema (draft-07 subset) — the
 *  common denominator every provider accepts for function/tool parameters. */
export interface AIToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A normalised tool call the model proposed. Same shape across all providers. */
export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AIToolChoice = 'auto' | 'none' | 'required' | { name: string };

export interface AIRequest {
  model: string; // resolved by the runner from the per-task tier mapping
  system?: string;
  messages: AIMessage[];
  tools?: AIToolDef[];
  toolChoice?: AIToolChoice;
  maxTokens?: number;
  temperature?: number;
}

export interface AIUsage { inputTokens?: number; outputTokens?: number }

export interface AIResult {
  text: string | null;
  toolCalls: AIToolCall[]; // always normalised; [] when none
  usage?: AIUsage;
  model: string;
  finishReason?: string;
}

export interface AIProvider {
  readonly id: string;
  /** True when an API key (and base URL, if needed) is present in the server env. */
  readonly configured: boolean;
  complete(req: AIRequest): Promise<AIResult>;
  /** Structured JSON output: forces a single tool whose schema is `schema` and
   *  returns the parsed arguments. Portable across every provider (avoids each
   *  vendor's bespoke JSON mode, which differs and isn't on all cheap models). */
  generateStructured<T = unknown>(req: AIRequest, schema: Record<string, unknown>): Promise<{ data: T | null; raw: AIResult }>;
}
