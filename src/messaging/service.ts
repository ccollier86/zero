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
import type { ConversationRecord, DurableMessage, MessagingDirectoryEntry, MessagingMutationOptions, MessagingPage, MessagingContact } from './contracts';
import type { MessagingServerApi } from './server-contracts';
import type { MessagingAttachmentService } from './attachment-service';
import { projectMessagingCommit as afterCommit } from './mutation-projection';
import { auditMessagingRead, type MessagingReadAction } from './read-audit';
import { messagingAssistantId } from './assistant-config';
import { directMessagingDisplay } from './conversation-display';

export interface MessagingAuthority { readonly access: RequestAuthorizationAccess; readonly scope: ServiceDataScope; assertCurrentAuthoritySync(): void }
export interface MessagingDirectory {
  assertScope(scope: ServiceDataScope): void;
  /** Must be synchronous and return no authority supplied by the client. */
  assertRecipient(scope: ServiceDataScope, userId: string): void;
  list(scope: ServiceDataScope, actorId: string, query: { after?: string; limit?: number; search?: string }): MessagingPage<MessagingDirectoryEntry>;
  resolve?(scope: ServiceDataScope, userIds: readonly string[]): readonly MessagingDirectoryEntry[];
  /** Synchronous current SYSTEM eligibility, evaluated only when a new native notice is first committed. */
  notificationRecipient(scope: ServiceDataScope, userId: string, staff: boolean): boolean;
  /** Current account, tenant and named-bot policy; absent adapters never admit internal assistant work. */
  assistantRecipient?(scope: ServiceDataScope, userId: string, assistantId: string): boolean;
  groupRecipient?(scope: ServiceDataScope, userId: string, groupId: string): boolean;
  groupCandidates?(scope: ServiceDataScope, after: string, limit: number): { readonly ids: readonly string[]; readonly hasMore: boolean };
}
export interface MessagingDependencies { readonly runtime: MessagingRuntime; readonly config: ResolvedMessagingConfig; readonly directory: MessagingDirectory; readonly attachments: MessagingAttachmentService; readonly logging?: LoggingRuntime; readonly jobs?: { wake(scope: ServiceDataScope): void }; readonly groups?: { ensure(scope: ServiceDataScope): Promise<void> } }
export const ZERO_MESSAGING = createZeroRuntimeServiceKey<MessagingService>('Managed messaging service');
/** Request-local closures retain no ambient mutable user, selected organization or native upload grants. */
export class MessagingService {
  constructor(private readonly deps: MessagingDependencies) {}
  get runtime(): MessagingRuntime { return this.deps.runtime; }
  /** @internal Reserved Sync typing uses current canonical membership, never a delayed RoomService shadow. */
  async typingMember(authority: MessagingAuthority, id: string, staffOnly: boolean, write: boolean): Promise<boolean> {
    const resolve = createMessagingActorResolver(authority, this.deps.config), captured = resolve(write);
    const check = () => { const current = resolve(write); if (current.id !== captured.id || current.staff !== captured.staff || messagingHash(current.assistantPolicies ?? {}) !== messagingHash(captured.assistantPolicies ?? {}) || messagingHash(current.groupPolicies ?? {}) !== messagingHash(captured.groupPolicies ?? {})) throw new AuthError('Messaging authority changed.', 'AUTH_STATE_CHANGED', 409); };
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
      if (current.id !== captured.id || current.scopeId !== captured.scopeId || current.staff !== captured.staff || messagingHash(current.assistantPolicies ?? {}) !== messagingHash(captured.assistantPolicies ?? {}) || messagingHash(current.groupPolicies ?? {}) !== messagingHash(captured.groupPolicies ?? {})) throw new AuthError('Messaging authority changed.', 'AUTH_STATE_CHANGED', 409);
      for (const id of recipients) this.deps.directory.assertRecipient(scope, id);
    };
    const mutation = (input: MessagingMutationOptions) => {
      const value = messagingRecord(input, ['requestId', 'signal']), requestId = messagingId(value.requestId), signal = value.signal;
      if (signal !== undefined && !(signal instanceof AbortSignal)) messagingFail('MESSAGING_INPUT_INVALID', 422);
      (signal as AbortSignal | undefined)?.throwIfAborted();
      return { requestId, signal: signal as AbortSignal | undefined };
    };
    const prepare = (name: string, input: object) => {
      const value = input as { id?: unknown; conversationId?: unknown };
      return name === 'messaging.conversations' || [value.id, value.conversationId].some(id => typeof id === 'string' && id.startsWith('group_')) ? this.deps.groups?.ensure(scope) : undefined;
    };
    const read = async <T>(name: string, input: object, signal?: AbortSignal): Promise<T> => {
      const captured = actor(), check = final(captured); await prepare(name, input); check();
      return this.runtime.read<T>(scope, name, { ...input, actor: captured }, check, signal);
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
      return attributed(captured, opts, check, async () => { await prepare(name, input); check(); return this.runtime.write<T>(scope, name, { ...input, actor: captured, requestId: opts.requestId }, transport, check, opts.signal); }).then(value => {
        this.deps.jobs?.wake(scope); return value;
      }, error => { if (error?.code === 'DATABASE_OUTCOME_UNKNOWN') this.deps.jobs?.wake(scope); throw error; });
    };
    const decorate = (rows: readonly ConversationRecord[]) => directMessagingDisplay(rows, ids => this.deps.directory.resolve?.(scope, ids) ?? []);
    const conversation = async (id: string, signal?: AbortSignal) => {
      const captured = actor(), check = final(captured), row = await read<ConversationRecord>('messaging.conversation', { id: messagingId(id) }, signal);
      check(); const result = decorate([row])[0]!; check(); return result;
    };
    const message = (conversationId: string, id: string, signal?: AbortSignal) => read<DurableMessage>('messaging.message', { conversationId: messagingId(conversationId), id: messagingId(id) }, signal);
    const changeConversation = (id: string, expectedRevision: number, action: string, value: unknown, options: MessagingMutationOptions) => {
      const target = messagingId(id), revision = messagingInteger(expectedRevision);
      return afterCommit(write('messaging.conversation.change', { id: target, expectedRevision: revision, action, value,
        ...(action === 'add' ? { maxParticipants: this.deps.config.maxParticipants, contactsOnly: this.deps.config.directory === 'contacts', history: this.deps.config.history } : {}) }, options,
      action === 'add' || action === 'transfer' ? [messagingId(value)] : []), () => conversation(target, options.signal));
    };
    const assistantPolicy = this.deps.config.assistant ? this.deps.config.assistant.policyHash : null;
    const supportAssistant = () => !!this.deps.config.support && !!this.deps.config.assistant && !!actor().assistantPolicies?.[this.deps.config.assistant.id];
    const ownership = (id: string, expectedEpoch: number, owner: 'human' | 'assistant' | 'triage', options: MessagingMutationOptions) => {
      if (owner === 'assistant' && !assistantPolicy && !Object.keys(actor(true).assistantPolicies ?? {}).length) messagingFail('MESSAGING_FORBIDDEN', 403);
      return afterCommit(write('messaging.conversation.owner', { id: messagingId(id), expectedEpoch: messagingInteger(expectedEpoch), owner, assistantPolicy,
        assistantId: this.deps.config.assistant ? this.deps.config.assistant.id : null }, options), () => conversation(id, options.signal));
    };
    const contact = <T>(action: string, userId: string, options: MessagingMutationOptions, expectedRevision?: number): Promise<T> =>
      write<T>('messaging.contact', { action, userId: messagingId(userId), ...(expectedRevision === undefined ? {} : { expectedRevision: messagingInteger(expectedRevision) }) }, options, action === 'request' || action === 'block' ? [userId] : []);
    const api: MessagingServerApi = {
      assistants: {
        list: options => audit('assistants', null, async () => {
          const captured = actor(), check = final(captured); check(); options?.signal?.throwIfAborted();
          const items = Object.values(this.deps.config.assistants).filter(value => captured.assistantPolicies?.[value.id]).sort((a, b) => a.id.localeCompare(b.id))
            .map(({ id, name, description }) => ({ id, name, description }));
          check(); return { items, hasMore: false, nextCursor: null };
        }),
        open: (id, input, options) => {
          const assistantId = messagingAssistantId(id), assistant = this.deps.config.assistants[assistantId], r = messagingRecord(input, ['title']), opts = mutation(options);
          if (!assistant || !actor(true).assistantPolicies?.[assistantId]) messagingFail('MESSAGING_NOT_FOUND', 404);
          if (!this.deps.jobs) messagingFail('MESSAGING_NOT_READY', 503);
          const conversationId = 'conversation_' + messagingHash([scopeId, identity.userId, opts.requestId]).slice(0, 40);
          return afterCommit(write('messaging.assistant.open', { id: conversationId, assistantId, title: messagingText(r.title ?? assistant.name, 200, true) }, opts), () => conversation(conversationId, opts.signal));
        },
      },
      review: {
        list: (conversationId, query = {}, options) => audit('review.list', messagingId(conversationId), () => read('messaging.reviews', { conversationId: messagingId(conversationId), query }, options?.signal)),
        get: (conversationId, id, options) => audit('review.detail', messagingId(conversationId), () => read('messaging.review', { conversationId: messagingId(conversationId), id: messagingId(id) }, options?.signal)),
        retry: (conversationId, id, epoch, acknowledgePossibleDuplicate, options) => {
          if (!assistantPolicy && !Object.keys(actor(true).assistantPolicies ?? {}).length) messagingFail('MESSAGING_FORBIDDEN', 403);
          return write('messaging.review.resolve', { conversationId: messagingId(conversationId), id: messagingId(id), expectedOwnerEpoch: messagingInteger(epoch), action: 'retry', acknowledgePossibleDuplicate, assistantPolicy }, options);
        },
        dismiss: (conversationId, id, epoch, options) => write('messaging.review.resolve', { conversationId: messagingId(conversationId), id: messagingId(id), expectedOwnerEpoch: messagingInteger(epoch), action: 'dismiss' }, options),
      },
      attachments: this.deps.attachments.forAuthority({ scope, capture: (write = false) => { const captured = actor(write); return { actor: captured, check: final(captured, write) }; },
        options: mutation, read, write: (name, input, options, fence) => write(name, input, options, [], fence),
        run: (options, operation) => { const captured = actor(true), opts = mutation(options); return attributed(captured, opts, final(captured, true), operation); } }),
      capabilities: async () => ({ enabled: true, directory: this.deps.config.directory, canSupport: actor().staff, maxMessageLength: this.deps.config.maxMessageLength, maxParticipants: this.deps.config.maxParticipants, maxUploadBytes: this.deps.config.maxUploadBytes,
        assistant: Object.keys(actor().assistantPolicies ?? {}).length > 0, notifications: this.deps.config.notifications, support: !!this.deps.config.support, supportAssistant: supportAssistant() }),
      directory: (query = {}, options) => audit('directory', null, async () => { const captured = actor(), check = final(captured); check(); options?.signal?.throwIfAborted();
        const page = this.deps.directory.list(scope, captured.id, query); check(); return page; }),
      receipt: (requestId, options) => read('messaging.receipt', { requestId: messagingId(requestId) }, options?.signal),
      conversations: {
        list: (query = {}, options) => audit('conversations', null, async () => {
          const captured = actor(), check = final(captured), page = await read<MessagingPage<ConversationRecord>>('messaging.conversations', { query }, options?.signal);
          check(); const result = { ...page, items: decorate(page.items) }; check(); return result;
        }),
        get: (id, options) => audit('conversation', messagingId(id), () => conversation(id, options?.signal)),
        people: (id, options) => audit('directory', messagingId(id), async () => {
          const captured = actor(), check = final(captured), record = await conversation(id, options?.signal);
          check(); options?.signal?.throwIfAborted();
          const users = new Map(this.deps.directory.resolve?.(scope, record.participants.filter(row => row.kind === 'user').map(row => row.id)).map(row => [row.id, row]) ?? []);
          const items = record.participants.map(member => ({ id: member.id, kind: member.kind,
            name: member.kind === 'user' ? users.get(member.id)?.name ?? 'Member' : member.kind === 'external' ? 'Visitor'
              : this.deps.config.assistants[member.id.slice('assistant:'.length)]?.name ?? 'Assistant',
            avatarUrl: member.kind === 'user' ? users.get(member.id)?.avatarUrl ?? null : null }));
          check(); return { items, hasMore: false, nextCursor: null };
        }),
        create: (input, options) => {
          const r = messagingRecord(input, ['kind', 'title', 'userIds']), opts = mutation(options), users = [...new Set(messagingArray(r.userIds, this.deps.config.maxParticipants - 1).map(messagingId))];
          const id = 'conversation_' + messagingHash([scopeId, identity.userId, opts.requestId]).slice(0, 40);
          return afterCommit(write('messaging.conversation.create', { id, kind: messagingChoice(r.kind ?? (users.length === 1 ? 'direct' : 'group'), ['direct', 'group']), title: messagingText(r.title ?? '', 200, true),
            userIds: users, contactsOnly: this.deps.config.directory === 'contacts', maxParticipants: this.deps.config.maxParticipants }, opts, users), () => conversation(id, opts.signal));
        },
        rename: (id, revision, title, opts) => changeConversation(id, revision, 'rename', messagingText(title, 200, true), opts),
        archive: (id, revision, archived, opts) => changeConversation(id, revision, 'archive', archived, opts),
        addParticipant: (id, revision, userId, opts) => changeConversation(id, revision, 'add', messagingId(userId), opts),
        transferOwnership: (id, revision, userId, opts) => changeConversation(id, revision, 'transfer', messagingId(userId), opts),
        removeParticipant: async (id, revision, participantId, opts) => { await write('messaging.conversation.change', { id: messagingId(id), expectedRevision: messagingInteger(revision), action: 'remove', value: messagingId(participantId) }, opts); return { removed: true }; },
        markRead: (id, throughSequence, opts) => afterCommit(write<{ throughSequence: number }>('messaging.conversation.read', { id: messagingId(id), throughSequence: messagingInteger(throughSequence, 0) }, opts), async accepted => {
          const current = await conversation(id, opts.signal); return { throughSequence: accepted.throughSequence, unreadCount: current.unreadCount };
        }),
        takeover: (id, epoch, opts) => ownership(id, epoch, 'human', opts),
        handBack: (id, epoch, owner, opts) => ownership(id, epoch, messagingChoice(owner, ['assistant', 'triage']), opts),
      },
      messages: {
        get: (conversationId, id, opts) => audit('history', messagingId(conversationId), () => message(conversationId, id, opts?.signal)),
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
      contacts: { list: (query = {}, opts) => audit('contacts', null, async () => {
        const captured = actor(), check = final(captured), page = await read<MessagingPage<MessagingContact>>('messaging.contacts', { query }, opts?.signal);
        check(); const names = new Map(this.deps.directory.resolve?.(scope, page.items.map(row => row.userId)).map(row => [row.id, row]) ?? []);
        const result = { ...page, items: page.items.map(row => ({ ...row, name: names.get(row.userId)?.name ?? 'Member', avatarUrl: names.get(row.userId)?.avatarUrl ?? null })) }; check(); return result;
      }), request: (userId, opts) => contact('request', userId, opts),
        respond: (userId, revision, accept, opts) => { if (typeof accept !== 'boolean') messagingFail('MESSAGING_INPUT_INVALID', 422); return contact(accept ? 'accept' : 'decline', userId, opts, revision); },
        block: (userId, opts) => contact('block', userId, opts), unblock: (userId, opts) => contact('unblock', userId, opts) },
      support: {
        open: (input, options) => {
          if (!this.deps.config.support) messagingFail('MESSAGING_FORBIDDEN', 403);
          const r = messagingRecord(input, ['title', 'mode']), opts = mutation(options), id = 'conversation_' + messagingHash([scopeId, identity.userId, opts.requestId]).slice(0, 40);
          const mode = r.mode === undefined ? undefined : messagingChoice(r.mode, ['assistant', 'human']);
          const automated = supportAssistant();
          if (mode === 'assistant' && !automated) messagingFail('MESSAGING_FORBIDDEN', 403);
          return afterCommit(write('messaging.support.open', { id, title: messagingText(r.title ?? '', 200, true), owner: mode !== 'human' && automated ? 'assistant' : 'triage', channelId: null,
            assistantId: this.deps.config.assistant ? this.deps.config.assistant.id : null }, opts), () => conversation(id, opts.signal));
        },
        queue: (query = {}, opts) => audit('support.queue', null, () => read('messaging.support.queue', { query }, opts?.signal)),
        claim: (id, epoch, opts) => afterCommit(write('messaging.support.claim', { id: messagingId(id), expectedEpoch: messagingInteger(epoch), maxParticipants: this.deps.config.maxParticipants }, opts), () => conversation(id, opts.signal)),
        requestHuman: (id, epoch, opts) => {
          if (!this.deps.config.support) messagingFail('MESSAGING_FORBIDDEN', 403);
          return afterCommit(write('messaging.support.request-human', { id: messagingId(id), expectedEpoch: messagingInteger(epoch) }, opts), () => conversation(id, opts.signal));
        },
      },
    };
    return Object.freeze({ ...api, assistants: Object.freeze(api.assistants), review: Object.freeze(api.review), conversations: Object.freeze(api.conversations), messages: Object.freeze(api.messages), contacts: Object.freeze(api.contacts), support: Object.freeze(api.support) });
  }
}
