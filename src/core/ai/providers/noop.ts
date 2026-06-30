// Default AI provider: does nothing. Returned by the registry whenever a provider
// isn't configured (no API key), so AI stays fully dormant — the runner short-circuits
// jobs to 'skipped' exactly like the email NoopSender leaves messages queued.
import 'server-only';
import type { AIProvider, AIRequest, AIResult } from '../types';

export class NoopProvider implements AIProvider {
  readonly id: string;
  readonly configured = false;
  constructor(id = 'noop') { this.id = id; }
  async complete(req: AIRequest): Promise<AIResult> {
    return { text: null, toolCalls: [], model: req.model, finishReason: 'not_configured' };
  }
  async generateStructured<T>(req: AIRequest): Promise<{ data: T | null; raw: AIResult }> {
    return { data: null, raw: await this.complete(req) };
  }
}
