/** Guardian-bound messaging facade. Mints actors and job policy; delegates closed transactions to private Fabric workers. */
import { AuthError } from '../auth/types';
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import type { LoggingRuntime } from '../logging/logging-runtime';
import { runWithLoggingAttribution } from '../logging/logging-attribution';
import type { ResolvedMessagingConfig } from './config';
import type { MessagingRuntime } from './runtime';
import { createZeroRuntimeServiceKey } from '../runtime/zero-app-runtime';
import type { MessagingActor } from './realm-model';
import { createMessagingActorResolver } from './authority';
import { messagingArray, messagingChoice, messagingFail, messagingHash, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';
import type { ConversationRecord, DurableMessage, MessagingDirectoryEntry, MessagingMutationOptions, MessagingPage } from './contracts';
import type { MessagingServerApi } from './server-contracts';
import type { MessagingAttachmentService } from './attachment-service';
import { projectMessagingCommit as afterCommit } from './mutation-projection';
import { auditMessagingRead, type MessagingReadAction } from './read-audit';

export interface MessagingAuthority { readonly access: RequestAuthorizationAccess; readonly scope: ServiceDataScope; assertCurrentAuthoritySync(): void }
export interface MessagingDirectory {
  assertScope(scope: ServiceDataScope): void;
  /** Must be synchronous and return no authority supplied by the client. */
  assertRecipient(scope: ServiceDataScope, userId: string): void;
  list(scope: ServiceDataScope, actorId: string, query: { after?: string; limit?: number; search?: string }): MessagingPage<MessagingDirectoryEntry>;
  /** Synchronous current SYSTEM eligibility, evaluated only when a new native notice is first committed. */
  notificationRecipient(scope: ServiceDataScope, userId: string, staff: boolean): boolean;
}
export interface MessagingDependencies { readonly runtime: MessagingRuntime; readonly config: ResolvedMessagingConfig; readonly directory: MessagingDirectory; readonly attachments: MessagingAttachmentService; readonly logging?: LoggingRuntime; readonly jobs?: { wake(scope: ServiceDataScope): void } }
export const ZERO_MESSAGING = createZeroRuntimeServiceKey<MessagingService>('Managed messaging service');
/** Request-local closures retain no ambient mutable user, selected organization or native upload grants. */
export class MessagingService {
  constructor(private readonly deps: MessagingDependencies) {}
  get runtime(): MessagingRuntime { return this.deps.runtime; }
  /** @internal Reserved Sync typing uses current canonical membership, never a delayed RoomService shadow. */
  async typingMember(authority: MessagingAuthority, id: string, staffOnly: boolean, write: boolean): Promise<boolean> {
    const resolve = createMessagingActorResolver(authority, this.deps.config), captured = resolve(write);
    const check = () => { const current = resolve(write); if (current.id !== captured.id || current.staff !== captured.staff) throw new AuthError('Messaging authority changed.', 'AUTH_STATE_CHANGED', 409); };
    try {
      const result = await this.runtime.read<{ active: boolean; staff: boolean }>(authority.scope, 'messaging.typing', { actor: captured, id: messagingId(id) }, check);
      return result.active && (!staffOnly || result.staff);
    } catch (error) { if (error instanceof AuthError && [403, 404].includes(error.status)) return false; throw error; }
  }
  forAuthority(authority: MessagingAuthority): MessagingServerApi {
    return this.facade(authority, true);
  }
  /** @internal Already-admitted live snapshots reauthorize normally, but are not new semantic reads or human views. */
  projectionForAuthority(authority: MessagingAuthority): MessagingServerApi {
    return this.facade(authority, false);
  }
  private facade(authority: MessagingAuthority, recordReads: boolean): MessagingServerApi {
    const identity = authority.access.requireUser(), scope = authority.scope, scopeId = serviceDataScopeKey(scope);
    const actor = createMessagingActorResolver(authority, this.deps.config);
    const final = (captured: MessagingActor, write = false, recipients: readonly string[] = []) => () => {
      const current = actor(write);
      if (current.id !== captured.id || current.scopeId !== captured.scopeId || current.staff !== captured.staff) throw new AuthError('Messaging authority changed.', 'AUTH_STATE_CHANGED', 409);
      for (const id of recipients) this.deps.directory.assertRecipient(scope, id);
    };
    const mutation = (input: MessagingMutationOptions) => {
      const value = messagingRecord(input, ['requestId', 'signal']), requestId = messagingId(value.requestId), signal = value.signal;
      if (signal !== undefined && !(signal instanceof AbortSignal)) messagingFail('MESSAGING_INPUT_INVALID', 422);
      (signal as AbortSignal | undefined)?.throwIfAborted();
      return { requestId, signal: signal as AbortSignal | undefined };
    };
    const read = <T>(name: string, input: object, signal?: AbortSignal): Promise<T> => {
      const captured = actor(); return this.runtime.read<T>(scope, name, { ...input, actor: captured }, final(captured), signal);
    };
    const audit = <T>(action: MessagingReadAction, conversationId: string | null, operation: () => Promise<T>): Promise<T> => {
      const captured = actor(), check = final(captured);
      return auditMessagingRead(recordReads ? this.deps.logging : undefined, {
        sourceId: 'messaging-request:' + messagingHash([captured.id]).slice(0, 40), origin: 'backend',
        scope: scope.tenantId === null ? { kind: 'application', tenantId: null } : { kind: 'tenant', tenantId: scope.tenantId },
        actor: { kind: 'user', id: captured.id, sessionId: identity.sessionId ?? null, initiatorId: null },
        requestId: null, correlationId: null, policyVersion: this.deps.logging?.config.policyVersion ?? 'disabled',
      }, action, conversationId, check, operation);
    };
    const attributed = <T>(captured: MessagingActor, opts: MessagingMutationOptions, check: () => void, operation: () => Promise<T>): Promise<T> => {
      const logging = this.deps.logging;
      return logging ? runWithLoggingAttribution(logging, { sourceId: 'messaging-request:' + messagingHash([captured.id]).slice(0, 40), origin: 'backend',
        scope: scope.tenantId === null ? { kind: 'application', tenantId: null } : { kind: 'tenant', tenantId: scope.tenantId },
        actor: { kind: 'user', id: captured.id, sessionId: identity.sessionId ?? null, initiatorId: null }, requestId: opts.requestId, correlationId: null, policyVersion: logging.config.policyVersion,
      }, check, operation) : operation();
    };
    const write = <T>(name: string, input: object, options: MessagingMutationOptions, recipients: readonly string[] = [], extra?: () => void): Promise<T> => {
      const captured = actor(true), opts = mutation(options), base = final(captured, true, recipients), check = () => { base(); extra?.(); };
      check(); const transport = 'messaging:' + messagingHash([scopeId, captured.kind, captured.id, opts.requestId]);
      return attributed(captured, opts, check, () => this.runtime.write<T>(scope, name, { ...input, actor: captured, requestId: opts.requestId }, transport, check, opts.signal)).then(value => {
        this.deps.jobs?.wake(scope); return value;
      }, error => { if (error?.code === 'DATABASE_OUTCOME_UNKNOWN') this.deps.jobs?.wake(scope); throw error; });
    };
    const conversation = (id: string, signal?: AbortSignal) => read<ConversationRecord>('messaging.conversation', { id: messagingId(id) }, signal);
    const message = (conversationId: string, id: string, signal?: AbortSignal) => read<DurableMessage>('messaging.message', { conversationId: messagingId(conversationId), id: messagingId(id) }, signal);
    const changeConversation = (id: string, expectedRevision: number, action: string, value: unknown, options: MessagingMutationOptions) => {
      const target = messagingId(id), revision = messagingInteger(expectedRevision);
      return afterCommit(write('messaging.conversation.change', { id: target, expectedRevision: revision, action, value,
        ...(action === 'add' ? { maxParticipants: this.deps.config.maxParticipants, contactsOnly: this.deps.config.directory === 'contacts', history: this.deps.config.history } : {}) }, options,
      action === 'add' ? [messagingId(value)] : []), () => conversation(target, options.signal));
    };
    const assistantPolicy = this.deps.config.assistant ? this.deps.config.assistant.policyHash : null;
    const ownership = (id: string, expectedEpoch: number, owner: 'human' | 'assistant' | 'triage', options: MessagingMutationOptions) => {
      if (owner === 'assistant' && !assistantPolicy) messagingFail('MESSAGING_FORBIDDEN', 403);
      return afterCommit(write('messaging.conversation.owner', { id: messagingId(id), expectedEpoch: messagingInteger(expectedEpoch), owner, assistantPolicy }, options), () => conversation(id, options.signal));
    };
    const contact = <T>(action: string, userId: string, options: MessagingMutationOptions, expectedRevision?: number): Promise<T> =>
      write<T>('messaging.contact', { action, userId: messagingId(userId), ...(expectedRevision === undefined ? {} : { expectedRevision: messagingInteger(expectedRevision) }) }, options, action === 'request' || action === 'block' ? [userId] : []);
    const api: MessagingServerApi = {
      review: {
        list: (conversationId, query = {}, options) => audit('review.list', messagingId(conversationId), () => read('messaging.reviews', { conversationId: messagingId(conversationId), query }, options?.signal)),
        get: (conversationId, id, options) => audit('review.detail', messagingId(conversationId), () => read('messaging.review', { conversationId: messagingId(conversationId), id: messagingId(id) }, options?.signal)),
        retry: (conversationId, id, epoch, acknowledgePossibleDuplicate, options) => {
          if (!assistantPolicy) messagingFail('MESSAGING_FORBIDDEN', 403);
          return write('messaging.review.resolve', { conversationId: messagingId(conversationId), id: messagingId(id), expectedOwnerEpoch: messagingInteger(epoch), action: 'retry', acknowledgePossibleDuplicate, assistantPolicy }, options);
        },
        dismiss: (conversationId, id, epoch, options) => write('messaging.review.resolve', { conversationId: messagingId(conversationId), id: messagingId(id), expectedOwnerEpoch: messagingInteger(epoch), action: 'dismiss' }, options),
      },
      attachments: this.deps.attachments.forAuthority({ scope, capture: (write = false) => { const captured = actor(write); return { actor: captured, check: final(captured, write) }; },
        options: mutation, read, write: (name, input, options, fence) => write(name, input, options, [], fence),
        run: (options, operation) => { const captured = actor(true), opts = mutation(options); return attributed(captured, opts, final(captured, true), operation); } }),
      capabilities: async () => ({ enabled: true, directory: this.deps.config.directory, canSupport: actor().staff, maxMessageLength: this.deps.config.maxMessageLength, maxParticipants: this.deps.config.maxParticipants, maxUploadBytes: this.deps.config.maxUploadBytes,
        assistant: Boolean(this.deps.config.assistant), notifications: this.deps.config.notifications }),
      directory: (query = {}, options) => audit('directory', null, async () => { const captured = actor(), check = final(captured); check(); options?.signal?.throwIfAborted();
        const page = this.deps.directory.list(scope, captured.id, query); check(); return page; }),
      receipt: (requestId, options) => read('messaging.receipt', { requestId: messagingId(requestId) }, options?.signal),
      conversations: {
        list: (query = {}, options) => audit('conversations', null, () => read('messaging.conversations', { query }, options?.signal)),
        get: (id, options) => audit('conversation', messagingId(id), () => conversation(id, options?.signal)),
        create: (input, options) => {
          const r = messagingRecord(input, ['kind', 'title', 'userIds']), opts = mutation(options), users = [...new Set(messagingArray(r.userIds, this.deps.config.maxParticipants - 1).map(messagingId))];
          const id = 'conversation_' + messagingHash([scopeId, identity.userId, opts.requestId]).slice(0, 40);
          return afterCommit(write('messaging.conversation.create', { id, kind: messagingChoice(r.kind ?? (users.length === 1 ? 'direct' : 'group'), ['direct', 'group']), title: messagingText(r.title ?? '', 200, true),
            userIds: users, contactsOnly: this.deps.config.directory === 'contacts', maxParticipants: this.deps.config.maxParticipants }, opts, users), () => conversation(id, opts.signal));
        },
        rename: (id, revision, title, opts) => changeConversation(id, revision, 'rename', messagingText(title, 200, true), opts),
        archive: (id, revision, archived, opts) => changeConversation(id, revision, 'archive', archived, opts),
        addParticipant: (id, revision, userId, opts) => changeConversation(id, revision, 'add', messagingId(userId), opts),
        removeParticipant: async (id, revision, participantId, opts) => { await write('messaging.conversation.change', { id: messagingId(id), expectedRevision: messagingInteger(revision), action: 'remove', value: messagingId(participantId) }, opts); return { removed: true }; },
        markRead: (id, throughSequence, opts) => afterCommit(write<{ throughSequence: number }>('messaging.conversation.read', { id: messagingId(id), throughSequence: messagingInteger(throughSequence, 0) }, opts), async accepted => {
          const current = await conversation(id, opts.signal); return { throughSequence: accepted.throughSequence, unreadCount: current.unreadCount };
        }),
        takeover: (id, epoch, opts) => ownership(id, epoch, 'human', opts),
        handBack: (id, epoch, owner, opts) => ownership(id, epoch, messagingChoice(owner, ['assistant', 'triage']), opts),
      },
      messages: {
        list: (conversationId, query = {}, opts) => audit('history', messagingId(conversationId), () => read('messaging.messages', { conversationId: messagingId(conversationId), query }, opts?.signal)),
        send: (conversationId, input, options) => {
          const r = messagingRecord(input, ['text', 'attachmentIds', 'visibility', 'expectedOwnerEpoch']), opts = mutation(options);
          return afterCommit(write<DurableMessage>('messaging.message.send', { ...r, conversationId: messagingId(conversationId), id: 'message_' + messagingHash([scopeId, identity.userId, opts.requestId]).slice(0, 40), maxMessageLength: this.deps.config.maxMessageLength,
            assistantEnabled: Boolean(assistantPolicy), assistantPolicy, notificationsEnabled: this.deps.config.notifications, notificationPath: this.deps.config.notificationPath }, opts), accepted => message(conversationId, accepted.id, opts.signal));
        },
        edit: (conversationId, id, revision, text, opts) => afterCommit(write('messaging.message.change', { conversationId: messagingId(conversationId), id: messagingId(id), expectedRevision: messagingInteger(revision), text: messagingText(text, this.deps.config.maxMessageLength), action: 'edit', maxMessageLength: this.deps.config.maxMessageLength, assistantPolicy }, opts), () => message(conversationId, id, opts.signal)),
        remove: (conversationId, id, revision, opts) => afterCommit(write('messaging.message.change', { conversationId: messagingId(conversationId), id: messagingId(id), expectedRevision: messagingInteger(revision), action: 'remove', maxMessageLength: this.deps.config.maxMessageLength, assistantPolicy }, opts), () => message(conversationId, id, opts.signal)),
        react: (conversationId, id, emoji, selected, opts) => afterCommit(write('messaging.message.react', { conversationId: messagingId(conversationId), id: messagingId(id), emoji, selected }, opts), () => message(conversationId, id, opts.signal)),
      },
      contacts: { list: (query = {}, opts) => audit('contacts', null, () => read('messaging.contacts', { query }, opts?.signal)), request: (userId, opts) => contact('request', userId, opts),
        respond: (userId, revision, accept, opts) => { if (typeof accept !== 'boolean') messagingFail('MESSAGING_INPUT_INVALID', 422); return contact(accept ? 'accept' : 'decline', userId, opts, revision); },
        block: (userId, opts) => contact('block', userId, opts), unblock: (userId, opts) => contact('unblock', userId, opts) },
      support: {
        open: (input, options) => {
          if (!this.deps.config.support) messagingFail('MESSAGING_FORBIDDEN', 403);
          const r = messagingRecord(input, ['title']), opts = mutation(options), id = 'conversation_' + messagingHash([scopeId, identity.userId, opts.requestId]).slice(0, 40);
          return afterCommit(write('messaging.support.open', { id, title: messagingText(r.title ?? '', 200, true), owner: assistantPolicy ? 'assistant' : 'triage', channelId: null }, opts), () => conversation(id, opts.signal));
        },
        queue: (query = {}, opts) => audit('support.queue', null, () => read('messaging.support.queue', { query }, opts?.signal)),
        claim: (id, epoch, opts) => afterCommit(write('messaging.support.claim', { id: messagingId(id), expectedEpoch: messagingInteger(epoch), maxParticipants: this.deps.config.maxParticipants }, opts), () => conversation(id, opts.signal)),
      },
    };
    return Object.freeze({ ...api, review: Object.freeze(api.review), conversations: Object.freeze(api.conversations), messages: Object.freeze(api.messages), contacts: Object.freeze(api.contacts), support: Object.freeze(api.support) });
  }
}
