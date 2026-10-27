/** Reuses Zero's authenticated SDK transport and data-boundary generation. Never owns another login client or retries mutations. */
import { MESSAGING_API, type MessagingMutationOptions } from '../../messaging/contracts';
import type { MessagingClient } from '../../messaging/client-contracts';
import type { FetchInit } from './sdk';
import { assertMessagingConversation, assertMessagingMessage, assertMessagingPage } from './messaging-response';
import { watchMessagingProjection } from './messaging-watch';
export function messagingQueryString(input: object = {}): string {
  const query = new URLSearchParams(); for (const key of ['before', 'after', 'limit', 'search', 'archived']) { const value = (input as Record<string, unknown>)[key]; if (value !== undefined) query.set(key, String(value)); }
  return query.size ? '?' + query : '';
}
export function createMessagingClient(fetch: <T>(path: string, init?: FetchInit) => Promise<T>): MessagingClient {
  let epoch = 0, boundary = new AbortController();
  const call = async <T>(path: string, method: string, body?: unknown, signal?: AbortSignal, requestId?: string, validate?: (value: unknown) => void): Promise<T> => {
    const captured = epoch, active = AbortSignal.any([boundary.signal, AbortSignal.timeout(30000), ...(signal ? [signal] : [])]); active.throwIfAborted();
    const value = await fetch<T>(MESSAGING_API + path, { method, ...(body === undefined ? {} : { body: structuredClone(body) }), ...(requestId ? { headers: { 'Idempotency-Key': requestId } } : {}), signal: active });
    active.throwIfAborted(); if (captured !== epoch) throw new DOMException('Messaging scope changed.', 'AbortError'); validate?.(value); return value;
  };
  const mutate = <T>(path: string, method: string, body: unknown, options: MessagingMutationOptions, validate?: (value: unknown) => void): Promise<T> => {
    if (!options || typeof options.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(options.requestId)) throw new Error('A stable messaging requestId is required.');
    return call(path, method, body, options.signal, options.requestId, validate);
  };
  const thread = (id: string) => '/conversations/' + encodeURIComponent(id), msg = (id: string, messageId: string) => thread(id) + '/messages/' + encodeURIComponent(messageId);
  return Object.freeze<MessagingClient>({
    capabilities: () => call('/config', 'GET'), directory: (query = {}, opts) => call('/directory' + messagingQueryString(query), 'GET', undefined, opts?.signal),
    receipt: (id, opts) => call('/receipts/' + encodeURIComponent(id), 'GET', undefined, opts?.signal),
    conversations: Object.freeze<MessagingClient['conversations']>({
      list: (query = {}, opts) => call('/conversations' + messagingQueryString(query), 'GET', undefined, opts?.signal, undefined, value => assertMessagingPage(value, assertMessagingConversation, 25)),
      get: (id, opts) => call(thread(id), 'GET', undefined, opts?.signal, undefined, assertMessagingConversation),
      create: (input, opts) => mutate('/conversations', 'POST', input, opts, assertMessagingConversation),
      rename: (id, expectedRevision, title, opts) => mutate(thread(id) + '/rename', 'POST', { expectedRevision, title }, opts, assertMessagingConversation),
      archive: (id, expectedRevision, archived, opts) => mutate(thread(id) + '/archive', 'POST', { expectedRevision, archived }, opts, assertMessagingConversation),
      addParticipant: (id, expectedRevision, userId, opts) => mutate(thread(id) + '/add', 'POST', { expectedRevision, userId }, opts, assertMessagingConversation),
      removeParticipant: (id, expectedRevision, userId, opts) => mutate(thread(id) + '/remove', 'POST', { expectedRevision, userId }, opts),
      markRead: (id, throughSequence, opts) => mutate(thread(id) + '/read', 'POST', { throughSequence }, opts),
      takeover: (id, expectedEpoch, opts) => mutate(thread(id) + '/takeover', 'POST', { expectedEpoch }, opts, assertMessagingConversation),
      handBack: (id, expectedEpoch, owner, opts) => mutate(thread(id) + '/hand-back', 'POST', { expectedEpoch, owner }, opts, assertMessagingConversation),
    }),
    messages: Object.freeze<MessagingClient['messages']>({
      list: (id, query = {}, opts) => call(thread(id) + '/messages' + messagingQueryString(query), 'GET', undefined, opts?.signal, undefined, value => assertMessagingPage(value, assertMessagingMessage, 50)),
      send: (id, input, opts) => mutate(thread(id) + '/messages', 'POST', input, opts, assertMessagingMessage),
      edit: (conversationId, id, expectedRevision, text, opts) => mutate(msg(conversationId, id), 'PUT', { expectedRevision, text }, opts, assertMessagingMessage),
      remove: (conversationId, id, expectedRevision, opts) => mutate(msg(conversationId, id), 'DELETE', { expectedRevision }, opts, assertMessagingMessage),
      react: (conversationId, id, emoji, selected, opts) => mutate(msg(conversationId, id) + '/reactions', 'POST', { emoji, selected }, opts, assertMessagingMessage),
    }),
    contacts: Object.freeze<MessagingClient['contacts']>({
      list: (query = {}, opts) => call('/contacts' + messagingQueryString(query), 'GET', undefined, opts?.signal),
      request: (id, opts) => mutate('/contacts/' + encodeURIComponent(id) + '/request', 'POST', {}, opts),
      respond: (id, expectedRevision, accept, opts) => mutate('/contacts/' + encodeURIComponent(id) + '/respond', 'POST', { expectedRevision, accept }, opts),
      block: (id, opts) => mutate('/contacts/' + encodeURIComponent(id) + '/block', 'POST', {}, opts),
      unblock: (id, opts) => mutate('/contacts/' + encodeURIComponent(id) + '/unblock', 'POST', {}, opts),
    }),
    support: Object.freeze<MessagingClient['support']>({
      open: (input, opts) => mutate('/support', 'POST', input, opts, assertMessagingConversation), queue: (query = {}, opts) => call('/support/queue' + messagingQueryString(query), 'GET', undefined, opts?.signal),
      claim: (id, expectedEpoch, opts) => mutate('/support/' + encodeURIComponent(id) + '/claim', 'POST', { expectedEpoch }, opts, assertMessagingConversation),
    }),
    watchConversations: (listener, options = {}) => watchMessagingProjection((path, signal) => fetch<Response>(MESSAGING_API + path, { signal, json: false }), '/conversations/live' + messagingQueryString(options.query), boundary.signal, listener, value => assertMessagingPage(value, assertMessagingConversation, 25), options),
    watchMessages: (id, listener, options = {}) => watchMessagingProjection((path, signal) => fetch<Response>(MESSAGING_API + path, { signal, json: false }), thread(id) + '/messages/live' + messagingQueryString(options.query), boundary.signal, listener, value => assertMessagingPage(value, assertMessagingMessage, 50), options),
    clear() { epoch++; boundary.abort(); boundary = new AbortController(); },
  });
}
