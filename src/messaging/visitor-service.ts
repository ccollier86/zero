/** Same-origin website support over the canonical Fabric/Storage/AI services; no Guardian account or general Sync grant is created. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { trustedSystemServiceDataScope, serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import { AuthError } from '../auth/types';
import { runWithLoggingAttribution } from '../logging/logging-attribution';
import type { LoggingContext } from '../logging/logging-contracts';
import type { MessagingDependencies } from './service';
import type { ResolvedMessagingSupportEntry } from './support-entry-config';
import type { MessagingActor } from './realm-model';
import type { ConversationRecord, DurableMessage, MessageHistoryQuery, MessagingMutationOptions, MessagingPage, MessagingPerson, MessagingReceipt, MessagingCapabilities } from './contracts';
import { messagingChoice, messagingFail, messagingHash, messagingId, messagingInteger, messagingRecord, messagingText } from './validation';
import { projectMessagingCommit } from './mutation-projection';
import { auditMessagingRead } from './read-audit';

export interface MessagingVisitorSession { readonly actor: MessagingActor; readonly expiresAt: number }
/** Internal request-bound facade. Every read/write rechecks the private session inside the source actor. */
export class MessagingVisitors {
  private starts = new Map<string, { minute: number; count: number }>();
  private streams = new Map<string, number>();
  private activityBudget = new Map<string, { minute: number; count: number }>();
  constructor(private readonly deps: MessagingDependencies) {}
  entry(id: string): ResolvedMessagingSupportEntry {
    const entry = this.deps.config.supportEntries[messagingId(id)];
    if (!entry || !this.deps.config.support) messagingFail('MESSAGING_NOT_FOUND', 404);
    this.check(entry); return entry;
  }
  scope(entry: ResolvedMessagingSupportEntry): ServiceDataScope {
    return trustedSystemServiceDataScope(entry.tenantId === null ? { scopeKind: 'application' } : { scopeKind: 'tenant', tenantId: entry.tenantId });
  }
  check(entry: ResolvedMessagingSupportEntry): void {
    if (this.deps.config.supportEntries[entry.id]?.policyHash !== entry.policyHash) messagingFail('MESSAGING_FORBIDDEN', 403);
    this.deps.directory.assertScope(this.scope(entry));
  }
  capabilities(entry: ResolvedMessagingSupportEntry): MessagingCapabilities {
    this.check(entry);
    return { enabled: true, directory: 'contacts', canSupport: false, support: true, supportAssistant: !!entry.assistantId, assistant: false, notifications: false,
      maxMessageLength: this.deps.config.maxMessageLength, maxParticipants: this.deps.config.maxParticipants, maxUploadBytes: this.deps.config.maxUploadBytes };
  }
  /** Exact Origin plus a non-simple request header; cross-site forms/images cannot start or read a session. No CORS is enabled here. */
  requestEntry(id: string, request: Request, write: boolean): ResolvedMessagingSupportEntry {
    const entry = this.entry(id), origin = request.headers.get('Origin'), fetchSite = request.headers.get('Sec-Fetch-Site');
    if (new URL(request.url).origin !== entry.origin || request.headers.get('X-Zero-Support-Client') !== '1' || origin !== null && origin !== entry.origin
      || write && origin !== entry.origin || fetchSite && !['same-origin', 'none'].includes(fetchSite)) messagingFail('MESSAGING_FORBIDDEN', 403);
    return entry;
  }
  cookieName(entry: ResolvedMessagingSupportEntry): string { return 'zero_support_' + entry.id; }
  cookie(entry: ResolvedMessagingSupportEntry, capability: string, clear = false): string {
    return `${this.cookieName(entry)}=${capability}; Path=/api/messaging/public/${entry.id}; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : entry.sessionTtlSeconds}${entry.origin.startsWith('https:') ? '; Secure' : ''}`;
  }
  capability(entry: ResolvedMessagingSupportEntry, request: Request): string | null {
    const matches = (request.headers.get('Cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(this.cookieName(entry) + '='));
    if (matches.length > 1) messagingFail('MESSAGING_FORBIDDEN', 403);
    if (!matches.length) return null;
    const value = matches[0]!.slice(this.cookieName(entry).length + 1);
    if (!/^session_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(value)) messagingFail('MESSAGING_FORBIDDEN', 403);
    return value;
  }
  csrf(capability: string): string { return messagingHash(['zero.support.csrf.v1', capability]); }
  assertCsrf(capability: string, request: Request): void {
    const actual = request.headers.get('X-Zero-Support-CSRF'), expected = this.csrf(capability);
    if (!actual || !/^[a-f0-9]{64}$/.test(actual) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) messagingFail('MESSAGING_FORBIDDEN', 403);
  }
  async resolve(entry: ResolvedMessagingSupportEntry, capability: string, signal?: AbortSignal): Promise<MessagingVisitorSession> {
    this.check(entry); const [id] = capability.split('.');
    return this.deps.runtime.read(this.scope(entry), 'messaging.visitor.session', { scopeId: serviceDataScopeKey(this.scope(entry)), entryId: entry.id, policyHash: entry.policyHash,
      id: messagingId(id), tokenHash: messagingHash(capability) }, () => this.check(entry), signal);
  }
  async start(entry: ResolvedMessagingSupportEntry, input: unknown, request: Request): Promise<{ session: MessagingVisitorSession; capability: string }> {
    const r = messagingRecord(input, ['mode']), mode = r.mode === undefined ? undefined : messagingChoice(r.mode, ['human', 'assistant']);
    const existing = this.capability(entry, request);
    if (existing) { this.assertCsrf(existing, request); return { session: await this.resolve(entry, existing, request.signal), capability: existing }; }
    if (mode === 'assistant' && !entry.assistantId) messagingFail('MESSAGING_FORBIDDEN', 403);
    if (mode !== 'human' && entry.assistantId && !this.deps.jobs) messagingFail('MESSAGING_NOT_READY', 503);
    // Per-process admission is deliberately secondary to the durable lifetime
    // budget in the source transaction. Neither trusts forwarded IP headers.
    const minute = Math.floor(Date.now() / 60000), prior = this.starts.get(entry.id), count = prior?.minute === minute ? prior.count : 0;
    if (count >= 30) messagingFail('MESSAGING_CAPACITY', 429); this.starts.set(entry.id, { minute, count: count + 1 });
    const id = 'session_' + crypto.randomUUID(), capability = id + '.' + randomBytes(32).toString('base64url'), scope = this.scope(entry), scopeId = serviceDataScopeKey(scope);
    const customerId = 'visitor_' + crypto.randomUUID(), conversationId = 'conversation_' + crypto.randomUUID();
    const context = this.context(entry, id, null);
    const operation = () => this.deps.runtime.write(scope, 'messaging.visitor.create', { scopeId, entryId: entry.id, policyHash: entry.policyHash, id, customerId, conversationId,
      tokenHash: messagingHash(capability), ttlSeconds: entry.sessionTtlSeconds, maxVisitors: entry.maxVisitors, title: entry.title,
      owner: mode !== 'human' && entry.assistantId ? 'assistant' : 'triage', assistantId: entry.assistantId }, 'visitor-create:' + id, () => this.check(entry), request.signal);
    if (this.deps.logging) await runWithLoggingAttribution(this.deps.logging, context, () => this.check(entry), operation); else await operation();
    return { capability, session: await this.resolve(entry, capability, request.signal) };
  }
  forSession(entry: ResolvedMessagingSupportEntry, session: MessagingVisitorSession, recordReads = true) {
    const actor = session.actor, scope = this.scope(entry), id = actor.visitor!.conversationId;
    const check = () => { this.check(entry); if (Date.now() >= session.expiresAt) messagingFail('MESSAGING_FORBIDDEN', 403); };
    const options = (value: MessagingMutationOptions) => {
      const r = messagingRecord(value, ['requestId', 'signal']); messagingId(r.requestId);
      if (r.signal !== undefined && !(r.signal instanceof AbortSignal)) messagingFail('MESSAGING_INPUT_INVALID', 422);
      value.signal?.throwIfAborted(); check(); return value;
    };
    const read = <T>(name: string, input: object, signal?: AbortSignal): Promise<T> => this.deps.runtime.read(scope, name, { ...input, actor }, check, signal);
    const attributed = <T>(opts: MessagingMutationOptions, operation: () => Promise<T>): Promise<T> => this.deps.logging
      ? runWithLoggingAttribution(this.deps.logging, this.context(entry, actor.visitor!.sessionId, opts.requestId), check, operation) : operation();
    const write = <T>(name: string, input: object, value: MessagingMutationOptions, fence?: () => void): Promise<T> => {
      const opts = options(value), guard = () => { check(); fence?.(); };
      return attributed(opts, () => this.deps.runtime.write<T>(scope, name, { ...input, actor, requestId: opts.requestId }, 'visitor:' + messagingHash([actor.scopeId, actor.id, opts.requestId]), guard, opts.signal))
        .then(result => { this.deps.jobs?.wake(scope); return result; }, failure => { if (failure?.code === 'DATABASE_OUTCOME_UNKNOWN') this.deps.jobs?.wake(scope); throw failure; });
    };
    const audit = <T>(action: 'conversation' | 'history', operation: () => Promise<T>) => auditMessagingRead(recordReads ? this.deps.logging : undefined,
      this.context(entry, actor.visitor!.sessionId, null), action, id, check, operation);
    const conversation = async (signal?: AbortSignal) => {
      const row = await read<ConversationRecord>('messaging.conversation', { id }, signal); check();
      const assistant = row.assistantId ? this.deps.config.assistants[row.assistantId] : undefined;
      return assistant ? { ...row, assistantName: assistant.name } : row;
    };
    const message = (messageId: string, signal?: AbortSignal) => read<DurableMessage>('messaging.message', { conversationId: id, id: messagingId(messageId) }, signal);
    const bind = (conversationId: string) => { if (conversationId !== id) messagingFail('MESSAGING_NOT_FOUND', 404); };
    const attachments = this.deps.attachments.forAuthority({ scope, capture() { check(); return { actor, check }; }, options, read,
      write: (name, input, opts, fence) => { bind((input as { conversationId: string }).conversationId); return write(name, input, opts, fence); }, run: attributed });
    const policy = entry.assistantId ? this.deps.config.assistants[entry.assistantId]?.policyHash ?? null : null;
    const namespace = serviceDataScopeKey(scope) + ':messaging:' + JSON.stringify([id, 'conversation']) + ':typing';
    const ephemeral = () => { const channel = this.deps.getEphemeral?.(); if (!channel) messagingFail('MESSAGING_NOT_READY', 503); return channel; };
    const typingAdmission = async () => { const value = await read<{ active: boolean }>('messaging.typing', { id }); check(); if (!value.active) messagingFail('MESSAGING_ARCHIVED'); };
    return {
      scope, actor, id, expiresAt: session.expiresAt, attachments,
      conversation: (signal?: AbortSignal) => audit('conversation', () => conversation(signal)),
      history: (query: MessageHistoryQuery = {}, signal?: AbortSignal) => audit('history', () => read<MessagingPage<DurableMessage>>('messaging.messages', { conversationId: id, query }, signal)),
      people: async (signal?: AbortSignal): Promise<MessagingPage<MessagingPerson>> => {
        const current = await conversation(signal); check(); const users = current.participants.filter(value => value.kind === 'user').map(value => value.id);
        const names = new Map(this.deps.directory.resolve?.(scope, users).map(value => [value.id, value]) ?? []);
        check(); return { items: current.participants.map(value => ({ id: value.id, kind: value.kind, name: value.id === actor.id ? 'You' : value.kind === 'assistant' ? 'Assistant' : names.get(value.id)?.name ?? 'Support', avatarUrl: names.get(value.id)?.avatarUrl ?? null })), hasMore: false, nextCursor: null };
      },
      receipt: (requestId: string, signal?: AbortSignal) => read<MessagingReceipt | null>('messaging.receipt', { requestId: messagingId(requestId) }, signal),
      message: (messageId: string, signal?: AbortSignal) => audit('history', () => message(messageId, signal)),
      send: (input: unknown, opts: MessagingMutationOptions) => {
        const r = messagingRecord(input, ['text', 'attachmentIds', 'visibility', 'expectedOwnerEpoch']);
        if (r.visibility !== undefined && r.visibility !== 'conversation') messagingFail('MESSAGING_FORBIDDEN', 403);
        return projectMessagingCommit(write<DurableMessage>('messaging.message.send', { ...r, conversationId: id, id: 'message_' + messagingHash([actor.scopeId, actor.id, opts.requestId]).slice(0, 40),
          maxMessageLength: this.deps.config.maxMessageLength, assistantEnabled: !!policy, assistantPolicy: policy, notificationsEnabled: this.deps.config.notifications, notificationPath: this.deps.config.notificationPath }, opts), value => message(value.id, opts.signal));
      },
      change: (messageId: string, revision: number, action: 'edit' | 'remove', text: string, opts: MessagingMutationOptions) => projectMessagingCommit(write('messaging.message.change', { conversationId: id,
        id: messagingId(messageId), expectedRevision: messagingInteger(revision), action, text: messagingText(text, this.deps.config.maxMessageLength, action === 'remove'), maxMessageLength: this.deps.config.maxMessageLength, assistantPolicy: policy }, opts), () => message(messageId, opts.signal)),
      react: (messageId: string, emoji: string, selected: boolean, opts: MessagingMutationOptions) => projectMessagingCommit(write('messaging.message.react', { conversationId: id, id: messagingId(messageId), emoji, selected }, opts), () => message(messageId, opts.signal)),
      markRead: (throughSequence: number, opts: MessagingMutationOptions) => projectMessagingCommit(write<{ throughSequence: number }>('messaging.conversation.read', { id, throughSequence: messagingInteger(throughSequence, 0) }, opts), async value => ({ ...value, unreadCount: (await conversation(opts.signal)).unreadCount })),
      requestHuman: (epoch: number, opts: MessagingMutationOptions) => projectMessagingCommit(write('messaging.support.request-human', { id, expectedEpoch: messagingInteger(epoch) }, opts), () => conversation(opts.signal)),
      revoke: (opts: MessagingMutationOptions) => write<{ revoked: true }>('messaging.visitor.revoke', {}, opts),
      observeTyping: (changed: () => void) => ephemeral().observeForService(namespace, changed),
      typing: async (signal?: AbortSignal) => {
        const conversation = await read<ConversationRecord>('messaging.conversation', { id }, signal); check();
        if (conversation.archived) return {};
        const members = new Set(conversation.participants.map(value => value.id)), result: Record<string, import('../sync/types').EphemeralWireEntry> = Object.create(null);
        // The shared pool is already bounded; release only current participants,
        // never private-note activity or an unrelated namespace.
        for (const [key, value] of Object.entries(ephemeral().snapshotForService(namespace))) if (members.has(value.userId) && Object.keys(result).length < 100) result[key] = value;
        check(); return result;
      },
      setTyping: async (input: unknown) => {
        const r = messagingRecord(input, ['tabId', 'activity']);
        if (typeof r.tabId !== 'string' || !/^[a-f0-9]{32}$/.test(r.tabId)) messagingFail('MESSAGING_INPUT_INVALID', 422);
        const activity = r.activity === null ? null : messagingChoice(r.activity, ['typing', 'recording', 'uploading']);
        const minute = Math.floor(Date.now() / 60000), prior = this.activityBudget.get(actor.id);
        if (!prior || prior.minute !== minute) {
          for (const [id, row] of this.activityBudget) if (row.minute !== minute) this.activityBudget.delete(id);
          if (this.activityBudget.size >= 1024) messagingFail('MESSAGING_CAPACITY', 429);
          this.activityBudget.set(actor.id, { minute, count: 0 });
        }
        const budget = this.activityBudget.get(actor.id)!; if (++budget.count > 180) messagingFail('MESSAGING_CAPACITY', 429);
        const now = Date.now(), value = activity === null ? null : { userId: actor.id, label: 'Visitor', since: now, updatedAt: now, metadata: { activity } };
        await ephemeral().writeForService(namespace, 'user:' + actor.id + ':session:' + r.tabId, actor.id, value, 5000, typingAdmission); check();
        return { accepted: true };
      },
    };
  }
  /** Four projection streams per browser session (list, latest, observed history and transient activity), bounded globally too. */
  reserveStream(session: MessagingVisitorSession): () => void {
    const id = session.actor.visitor!.sessionId, count = this.streams.get(id) ?? 0;
    if (count >= 4 || [...this.streams.values()].reduce((total, count) => total + count, 0) >= 256) throw new AuthError('Support stream capacity is exhausted.', 'MESSAGING_CAPACITY', 429);
    this.streams.set(id, count + 1); let released = false;
    return () => { if (released) return; released = true; const remaining = (this.streams.get(id) ?? 1) - 1; if (remaining) this.streams.set(id, remaining); else this.streams.delete(id); };
  }
  private context(entry: ResolvedMessagingSupportEntry, sessionId: string, requestId: string | null): LoggingContext {
    return { sourceId: 'messaging-visitor:' + messagingHash(sessionId).slice(0, 40), origin: 'backend', scope: entry.tenantId === null ? { kind: 'application', tenantId: null } : { kind: 'tenant', tenantId: entry.tenantId },
      actor: { kind: 'anonymous', id: null, sessionId, initiatorId: null }, requestId, correlationId: null, policyVersion: this.deps.logging?.config.policyVersion ?? 'disabled' };
  }
}
