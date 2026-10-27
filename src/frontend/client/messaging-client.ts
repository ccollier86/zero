/** Reuses Zero's authenticated SDK transport and data-boundary generation. Never owns another login client or retries mutations. */
import { MESSAGING_API, type MessagingMutationOptions } from '../../messaging/contracts';
import type { MessagingClient } from '../../messaging/client-contracts';
import type { FetchInit } from './sdk';
import { assertMessagingConversation, assertMessagingMessage, assertMessagingPage, assertMessagingCapabilities, assertMessagingDirectoryEntry, assertMessagingReceipt,
  assertMessagingContact, assertMessagingReadPosition, assertMessagingRemoved, assertMessagingUnblocked, assertMessagingSupportQueueItem, assertMessagingAssistant } from './messaging-response';
import { watchMessagingProjection } from './messaging-watch';
import { createMessagingAttachmentClient, type MessagingBinaryTransport } from './messaging-attachment-client';
import { assertMessagingReviewItem, assertMessagingReviewDetail, assertMessagingReviewResolution } from './messaging-review-response';
export function messagingQueryString(input: object = {}): string {
  const query = new URLSearchParams(); for (const key of ['before', 'after', 'limit', 'search', 'archived']) { const value = (input as Record<string, unknown>)[key]; if (value !== undefined) query.set(key, String(value)); }
  return query.size ? '?' + query : '';
}
export function createMessagingClient(fetch: <T>(path: string, init?: FetchInit) => Promise<T>, raw?: MessagingBinaryTransport): MessagingClient {
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
    assistants: Object.freeze<MessagingClient['assistants']>({
      list: opts => call('/assistants', 'GET', undefined, opts?.signal, undefined, value => assertMessagingPage(value, assertMessagingAssistant, 32)),
      open: (id, input, opts) => mutate('/assistants/' + encodeURIComponent(id) + '/conversations', 'POST', input, opts, assertMessagingConversation),
    }),
    review: Object.freeze<MessagingClient['review']>({
      list: (id, query = {}, opts) => call(thread(id) + '/review' + messagingQueryString(query), 'GET', undefined, opts?.signal, undefined, value => assertMessagingPage(value, assertMessagingReviewItem, 50)),
      get: (id, jobId, opts) => call(thread(id) + '/review/' + encodeURIComponent(jobId), 'GET', undefined, opts?.signal, undefined, assertMessagingReviewDetail),
      retry: (id, jobId, expectedOwnerEpoch, acknowledgePossibleDuplicate, opts) => mutate(thread(id) + '/review/' + encodeURIComponent(jobId) + '/retry', 'POST', { expectedOwnerEpoch, acknowledgePossibleDuplicate }, opts, assertMessagingReviewResolution),
      dismiss: (id, jobId, expectedOwnerEpoch, opts) => mutate(thread(id) + '/review/' + encodeURIComponent(jobId) + '/dismiss', 'POST', { expectedOwnerEpoch }, opts, assertMessagingReviewResolution),
    }),
    attachments: createMessagingAttachmentClient(call, raw, () => boundary.signal),
    capabilities: () => call('/config', 'GET', undefined, undefined, undefined, assertMessagingCapabilities), directory: (query = {}, opts) => call('/directory' + messagingQueryString(query), 'GET', undefined, opts?.signal, undefined, value => assertMessagingPage(value, assertMessagingDirectoryEntry, 50)),
    receipt: (id, opts) => call('/receipts/' + encodeURIComponent(id), 'GET', undefined, opts?.signal, undefined, assertMessagingReceipt),
    conversations: Object.freeze<MessagingClient['conversations']>({
      list: (query = {}, opts) => call('/conversations' + messagingQueryString(query), 'GET', undefined, opts?.signal, undefined, value => assertMessagingPage(value, assertMessagingConversation, 25)),
      get: (id, opts) => call(thread(id), 'GET', undefined, opts?.signal, undefined, assertMessagingConversation),
      create: (input, opts) => mutate('/conversations', 'POST', input, opts, assertMessagingConversation),
      rename: (id, expectedRevision, title, opts) => mutate(thread(id) + '/rename', 'POST', { expectedRevision, title }, opts, assertMessagingConversation),
      archive: (id, expectedRevision, archived, opts) => mutate(thread(id) + '/archive', 'POST', { expectedRevision, archived }, opts, assertMessagingConversation),
      addParticipant: (id, expectedRevision, userId, opts) => mutate(thread(id) + '/add', 'POST', { expectedRevision, userId }, opts, assertMessagingConversation),
      transferOwnership: (id, expectedRevision, userId, opts) => mutate(thread(id) + '/transfer', 'POST', { expectedRevision, userId }, opts, assertMessagingConversation),
      removeParticipant: (id, expectedRevision, userId, opts) => mutate(thread(id) + '/remove', 'POST', { expectedRevision, userId }, opts, assertMessagingRemoved),
      markRead: (id, throughSequence, opts) => mutate(thread(id) + '/read', 'POST', { throughSequence }, opts, assertMessagingReadPosition),
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
      list: (query = {}, opts) => call('/contacts' + messagingQueryString(query), 'GET', undefined, opts?.signal, undefined, value => assertMessagingPage(value, assertMessagingContact, 50)),
      request: (id, opts) => mutate('/contacts/' + encodeURIComponent(id) + '/request', 'POST', {}, opts, assertMessagingContact),
      respond: (id, expectedRevision, accept, opts) => mutate('/contacts/' + encodeURIComponent(id) + '/respond', 'POST', { expectedRevision, accept }, opts, assertMessagingContact),
      block: (id, opts) => mutate('/contacts/' + encodeURIComponent(id) + '/block', 'POST', {}, opts, assertMessagingContact),
      unblock: (id, opts) => mutate('/contacts/' + encodeURIComponent(id) + '/unblock', 'POST', {}, opts, assertMessagingUnblocked),
    }),
    support: Object.freeze<MessagingClient['support']>({
      open: (input, opts) => mutate('/support', 'POST', input, opts, assertMessagingConversation), queue: (query = {}, opts) => call('/support/queue' + messagingQueryString(query), 'GET', undefined, opts?.signal, undefined, value => assertMessagingPage(value, assertMessagingSupportQueueItem, 50)),
      claim: (id, expectedEpoch, opts) => mutate('/support/' + encodeURIComponent(id) + '/claim', 'POST', { expectedEpoch }, opts, assertMessagingConversation),
    }),
    watchConversations: (listener, options = {}) => watchMessagingProjection((path, signal) => fetch<Response>(MESSAGING_API + path, { signal, json: false }), '/conversations/live' + messagingQueryString(options.query), boundary.signal, listener, value => assertMessagingPage(value, assertMessagingConversation, 25), options),
    watchMessages: (id, listener, options = {}) => watchMessagingProjection((path, signal) => fetch<Response>(MESSAGING_API + path, { signal, json: false }), thread(id) + '/messages/live' + messagingQueryString(options.query), boundary.signal, listener, value => assertMessagingPage(value, assertMessagingMessage, 50), options),
    clear() { epoch++; boundary.abort(); boundary = new AbortController(); },
  });
}
