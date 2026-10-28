'use client';
/** Cookie-only website client. No capability enters JS, a URL or localStorage; CSRF and session fences are memory-only. */
import { createMessagingClient } from '../frontend/client/messaging-client';
import type { MessagingClient } from './client-contracts';
import { MESSAGING_API } from './contracts';
import type { MessagingMutationOptions } from './contracts';
import { watchMessagingProjection } from '../frontend/client/messaging-watch';
import type { EphemeralWireEntry } from '../sync/types';
import type { MessagingActivity } from './presentation';
export interface SupportChatClient {
  readonly userId: string; readonly conversationId: string; readonly scopeKey: string; readonly expiresAt: number;
  readonly capabilities: MessagingClient['capabilities']; readonly receipt: MessagingClient['receipt'];
  readonly conversations: Pick<MessagingClient['conversations'], 'get' | 'people' | 'markRead'>;
  readonly messages: MessagingClient['messages']; readonly attachments: MessagingClient['attachments'];
  readonly support: Pick<MessagingClient['support'], 'requestHuman'>;
  readonly watchMessages: MessagingClient['watchMessages'];
  readonly typing: {
    set(tabId: string, activity: MessagingActivity | null, options?: { signal?: AbortSignal }): Promise<void>;
    watch(listener: (entries: Readonly<Record<string, EphemeralWireEntry>>) => void, options?: { signal?: AbortSignal; onError?(error: unknown): void }): () => void;
  };
  readonly active: boolean;
  subscribe(listener: () => void): () => void;
  /** Explicitly end the visitor session; this does not delete retained conversations/evidence. */
  end(options: MessagingMutationOptions): Promise<void>;
  /** Retire in-memory subscriptions without logging out the server session. */
  clear(): void;
}
export interface SupportChatConnectOptions { mode?: 'human' | 'assistant'; signal?: AbortSignal;
  /** Restore an existing cookie only; never provision a visitor just because a page mounted. */
  resumeOnly?: boolean;
  /** @internal Test/host transport; the server still enforces its exact configured same-origin policy. */
  transport?: typeof globalThis.fetch }
const sources = new WeakMap<SupportChatClient, MessagingClient>();
/** @internal The managed widget reuses the existing controller, never a fork of send/file/history behavior. */
export function supportWorkspaceSource(client: SupportChatClient): MessagingClient { const source = sources.get(client); if (!source) throw new Error('A native support client is required.'); return source; }
export async function createSupportChatClient(entry: string, options: SupportChatConnectOptions = {}): Promise<SupportChatClient> {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(entry)) throw new Error('A configured support entry is required.');
  const root = MESSAGING_API + '/public/' + entry, fetcher = options.transport ?? globalThis.fetch;
  const abort = new AbortController(); let csrf = '', sessionId = '', retired = false;
  const raw = (path: string, init: RequestInit = {}) => {
    if (retired) throw new DOMException('Support session retired.', 'AbortError');
    if (!path.startsWith(MESSAGING_API + '/')) throw new Error('Unsupported support request.');
    const headers = new Headers(init.headers); headers.set('X-Zero-Support-Client', '1');
    if (csrf) headers.set('X-Zero-Support-CSRF', csrf); if (sessionId) headers.set('X-Zero-Support-Session', sessionId);
    return fetcher(root + path.slice(MESSAGING_API.length), { ...init, credentials: 'same-origin', cache: 'no-store', headers,
      signal: AbortSignal.any([abort.signal, ...(init.signal ? [init.signal] : [])]) });
  };
  const json = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await raw(path, init), value = await readSupportJson(response, init.signal ?? abort.signal);
    if (!response.ok) {
      const r = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      throw Object.assign(new Error('The support request was not accepted.'), { status: response.status,
        ...(typeof r.code === 'string' && /^[A-Z][A-Z_]{1,100}$/.test(r.code) ? { code: r.code } : {}), ...(r.outcome === 'unknown' ? { outcome: 'unknown' } : {}) });
    }
    return value as T;
  };
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30000), ...(options.signal ? [options.signal] : [])]);
  let metadata: unknown;
  try { metadata = await json(MESSAGING_API + '/session', { signal }); }
  catch (failure) {
    // Missing cookies are not distinguished from rejected cookies on the wire.
    // Only a deliberate connect starts a new session; rejected retained cookies
    // are never silently replaced with a different identity/history.
    if (options.resumeOnly || !(failure && typeof failure === 'object' && 'status' in failure && failure.status === 403)) throw failure;
    metadata = await json(MESSAGING_API + '/session', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.mode ? { mode: options.mode } : {}) });
  }
  const m = metadata as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || !['sessionId', 'userId', 'conversationId'].every(key => typeof m[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(m[key] as string))
    || typeof m.csrf !== 'string' || !/^[a-f0-9]{64}$/.test(m.csrf) || !Number.isSafeInteger(m.expiresAt) || (m.expiresAt as number) <= Date.now()) throw new Error('The support session response is invalid.');
  csrf = m.csrf; sessionId = m.sessionId as string;
  const source = createMessagingClient(<T>(path: string, init: import('../frontend/client/sdk').FetchInit = {}): Promise<T> => {
    const { json: expectsJson, body, ...rest } = init;
    const headers = new Headers(rest.headers as HeadersInit); if (body !== undefined) headers.set('Content-Type', 'application/json');
    const request = { ...rest, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) } as RequestInit;
    return expectsJson === false ? raw(path, request) as Promise<T> : json<T>(path, request);
  }, raw);
  const channel = typeof BroadcastChannel !== 'undefined' && typeof window !== 'undefined' ? new BroadcastChannel('zero.support.' + entry) : null;
  const listeners = new Set<() => void>();
  const clear = () => { if (retired) return; retired = true; abort.abort(); source.clear(); channel?.close(); csrf = ''; for (const listener of listeners) listener(); listeners.clear(); };
  const client: SupportChatClient = Object.freeze({ userId: m.userId as string, conversationId: m.conversationId as string, scopeKey: 'support:' + entry + ':' + sessionId, expiresAt: m.expiresAt as number,
    capabilities: source.capabilities, receipt: source.receipt, conversations: Object.freeze({ get: source.conversations.get, people: source.conversations.people, markRead: source.conversations.markRead }),
    messages: source.messages, attachments: source.attachments, support: Object.freeze({ requestHuman: source.support.requestHuman }), watchMessages: source.watchMessages,
    typing: Object.freeze({
      async set(tabId: string, activity: MessagingActivity | null, opts?: { signal?: AbortSignal }) {
        const value = await json<{ accepted: boolean }>(MESSAGING_API + '/typing', { method: 'POST', signal: opts?.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tabId, activity }) });
        if (value.accepted !== true) throw new Error('Typing publication is unconfirmed.');
      },
      watch: (listener: (entries: Readonly<Record<string, EphemeralWireEntry>>) => void, opts: { signal?: AbortSignal; onError?(error: unknown): void } = {}) => watchMessagingProjection((path, signal) => raw(MESSAGING_API + path, { signal }), '/typing/live', abort.signal, listener, assertSupportTyping, opts),
    }),
    get active() { return !retired; }, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async end(opts: MessagingMutationOptions) {
      if (!opts || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(opts.requestId)) throw new Error('A stable end-session request identity is required.');
      const value = await json<{ ended: boolean }>(MESSAGING_API + '/session', { method: 'DELETE', signal: opts.signal, headers: { 'Idempotency-Key': opts.requestId } });
      if (value.ended !== true) throw new Error('Support session end is unconfirmed.'); channel?.postMessage({ ended: sessionId }); clear();
    }, clear });
  if (channel) channel.onmessage = event => { if (event.data?.ended === sessionId) clear(); };
  sources.set(client, source); return client;
}
function assertSupportTyping(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100) throw new Error('Invalid support activity.');
  for (const [key, entry] of Object.entries(value)) {
    if (!key.startsWith('user:') || key.length > 256 || !entry || typeof entry !== 'object' || !('userId' in entry) || typeof entry.userId !== 'string' || entry.userId.length > 200
      || !('value' in entry) || !entry.value || typeof entry.value !== 'object' || !('label' in entry.value) || typeof entry.value.label !== 'string' || entry.value.label.length > 160
      || !('freshness' in entry) || !entry.freshness || typeof entry.freshness !== 'object' || !('ageMs' in entry.freshness) || !('ttlMs' in entry.freshness)
      || typeof entry.freshness.ageMs !== 'number' || !Number.isFinite(entry.freshness.ageMs) || entry.freshness.ageMs < 0 || typeof entry.freshness.ttlMs !== 'number' || !Number.isFinite(entry.freshness.ttlMs) || entry.freshness.ttlMs <= 0 || entry.freshness.ttlMs > 15000) throw new Error('Invalid support activity.');
  }
}
/** Explicit recovery for an expired/revoked cookie. A still-active session cannot be forgotten without its CSRF proof. */
export async function forgetExpiredSupportChat(entry: string, options: Pick<SupportChatConnectOptions, 'signal' | 'transport'> = {}): Promise<void> {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(entry)) throw new Error('A configured support entry is required.');
  const signal = AbortSignal.any([AbortSignal.timeout(30000), ...(options.signal ? [options.signal] : [])]);
  const response = await (options.transport ?? globalThis.fetch)(MESSAGING_API + '/public/' + entry + '/session', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', signal, headers: { 'X-Zero-Support-Client': '1' } });
  const value = await readSupportJson(response, signal);
  if (!response.ok || !value || typeof value !== 'object' || !('ended' in value) || value.ended !== true) throw new Error('The current support session could not be forgotten. Reconnect an active chat before ending it.');
}
async function readSupportJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error('The support response is unavailable.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted(); if (next.done) break; size += next.value.byteLength; if (size > 512 * 1024) throw new Error('The support response is too large.'); chunks.push(next.value); }
    const bytes = new Uint8Array(size); let position = 0; for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
