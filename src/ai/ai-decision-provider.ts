/** Native Jev / compatible Laya HTTP transport, deliberately outside the AI SDK. */
import { AIError } from './ai-errors';
import type { AIProviderType, AIFetchFunction, ResolvedAIProviderConfig } from './ai-provider-types';
import { snapshotAIHeaders } from './ai-request-snapshot';
import type { AIDecisionDeadline } from './ai-decision-deadline';
import { AI_DECISION_MAX_RESPONSE_BYTES } from './ai-decision-validation';
import { invalidDecisionResponse } from './ai-decision-response';
import { createLayaInputAdmission, type PreparedLayaInput } from './ai-decision-input-limits';

export function isNativeDecisionProvider(type: AIProviderType): type is 'jev' | 'laya' {
  return type === 'jev' || type === 'laya';
}

/** Captures credentials, endpoint and fetch at startup; requests cannot override them. */
export class NativeDecisionProvider {
  readonly locality: 'local' | 'hosted';
  private readonly endpoint: string;
  private readonly headers: Headers;
  private readonly fetch: AIFetchFunction;
  private readonly admitInput: ReturnType<typeof createLayaInputAdmission>;

  constructor(provider: ResolvedAIProviderConfig) {
    if (!isNativeDecisionProvider(provider.type)) throw invalidConfiguration();
    if (provider.decisionLocality !== undefined && !['local', 'hosted'].includes(provider.decisionLocality)) throw invalidConfiguration();
    if (provider.type === 'jev' && provider.decisionLocality === 'local') throw invalidConfiguration();
    this.locality = provider.type === 'jev' ? 'hosted' : provider.decisionLocality ?? 'hosted';
    this.endpoint = decisionEndpoint(provider.baseURL);
    this.admitInput = provider.type === 'laya' ? createLayaInputAdmission(provider.layaInputLimits) : undefined;
    try {
      this.headers = new Headers(snapshotAIHeaders(provider.headers));
      if (provider.apiKey) this.headers.set('Authorization', `Bearer ${provider.apiKey}`);
      this.headers.set('Content-Type', 'application/json');
      this.headers.set('Accept', 'application/json');
      this.fetch = provider.fetch ?? globalThis.fetch;
      if (typeof this.fetch !== 'function') throw invalidConfiguration();
    } catch { throw invalidConfiguration(); }
  }

  /** Runs before any HTTP request; caller overrides can lower, never raise, this ceiling. */
  assertInputFits(input: PreparedLayaInput): void { this.admitInput?.(input); }

  async evaluate(body: string, maxRetries: number, deadline: AIDecisionDeadline): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      deadline.assertCurrent();
      let response: Response;
      try {
        const pending = Promise.resolve(this.fetch(this.endpoint, {
          method: 'POST', headers: new Headers(this.headers), body,
          signal: deadline.signal, redirect: 'error',
        })).then(value => {
          if (deadline.signal.aborted) cancelBody(value);
          return value;
        });
        response = await deadline.wait(pending);
      } catch {
        deadline.assertCurrent();
        throw new AIError('AI decision provider request failed.', 'AI_REQUEST_FAILED', 502);
      }
      if (!(response instanceof Response) || response.redirected) {
        cancelBody(response);
        throw invalidDecisionResponse();
      }
      if (response.ok) return await readDecisionJSON(response, deadline);
      const status = response.status;
      const retryAfter = retryDelay(response.headers.get('retry-after'), attempt);
      cancelBody(response);
      if (attempt < maxRetries && (status === 429 || status === 529 || status >= 500)) {
        await deadline.delay(retryAfter);
        continue;
      }
      throw new AIError('AI decision provider rejected the request.', 'AI_REQUEST_FAILED', status >= 400 && status <= 599 ? status : 502);
    }
  }
}

function decisionEndpoint(baseURL: string | null | undefined): string {
  try {
    if (!baseURL) throw invalidConfiguration();
    const url = new URL(baseURL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw invalidConfiguration();
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/systemone') ? path : path.endsWith('/v1') ? `${path}/systemone` : `${path}/v1/systemone`;
    return url.toString();
  } catch { throw invalidConfiguration(); }
}
function invalidConfiguration(): AIError {
  return new AIError('AI decision provider requires a valid HTTP(S) endpoint and deployment configuration.', 'AI_PROVIDER_CONFIG_INVALID', 500);
}
function cancelBody(response: unknown): void {
  try { if (response instanceof Response) void response.body?.cancel().catch(() => undefined); } catch { /* best-effort abandoned-body cleanup */ }
}
function retryDelay(header: string | null, attempt: number): number {
  if (header !== null) {
    const seconds = Number(header), date = Date.parse(header);
    const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
    if (ms !== null) return Math.min(120_000, ms);
  }
  return Math.min(2000, 100 * 2 ** attempt);
}

async function readDecisionJSON(response: Response, deadline: AIDecisionDeadline): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > AI_DECISION_MAX_RESPONSE_BYTES) {
    cancelBody(response); throw invalidDecisionResponse();
  }
  if (!response.body) throw invalidDecisionResponse();
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '', completed = false;
  try {
    for (;;) {
      const chunk = await deadline.wait(reader.read());
      if (chunk.done) { completed = true; break; }
      if (!(chunk.value instanceof Uint8Array)) throw invalidDecisionResponse();
      bytes += chunk.value.byteLength;
      if (bytes > AI_DECISION_MAX_RESPONSE_BYTES) throw invalidDecisionResponse();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    deadline.assertCurrent();
    return JSON.parse(text);
  } catch {
    deadline.assertCurrent();
    throw invalidDecisionResponse();
  } finally {
    if (!completed) void reader.cancel().catch(() => undefined);
    try { reader.releaseLock(); } catch { /* source still owns a pending read */ }
  }
}
