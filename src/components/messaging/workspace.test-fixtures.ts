/** Synthetic public facade for deterministic controller tests. No private DB, auth bypass or live provider. */
import type { MessagingClient, MessagingWatchOptions } from '../../messaging/client-contracts';
import type { ConversationRecord, DurableMessage, MessageHistoryQuery, MessagingMutationOptions, MessagingPage } from '../../messaging/contracts';
export function workspaceMessage(sequence: number, conversationId = 'one'): DurableMessage {
  return { id: `${conversationId}-${sequence}`, conversationId, sequence, revision: 1, authorId: 'peer', authorKind: 'user', visibility: 'conversation', text: 'Synthetic message ' + sequence,
    createdAt: sequence, editedAt: null, deleted: false, attachmentIds: [], reactions: [] };
}
export function workspaceConversation(id = 'one'): ConversationRecord {
  return { id, kind: 'direct', title: '', revision: 1, createdAt: 1, updatedAt: 1, archived: false, owner: 'human', ownerId: 'me', ownerEpoch: 1, unreadCount: 3,
    participants: [{ id: 'me', kind: 'user', role: 'owner', joinedAt: 1 }, { id: 'peer', kind: 'user', role: 'member', joinedAt: 1, name: 'Peer' }], lastMessage: null };
}
export function workspaceFixture(count = 70) {
  let valid = true;
  const messages: DurableMessage[] = Array.from({ length: count }, (_, index) => workspaceMessage(index + 1));
  const reads: number[] = [], sends: Array<{ id: string; input: any; options: MessagingMutationOptions }> = [];
  const listWatchers = new Set<{ listener: (page: MessagingPage<ConversationRecord>) => void; options: MessagingWatchOptions<any> }>();
  const watchers = new Set<{ id: string; listener: (page: MessagingPage<DurableMessage>) => void; options: MessagingWatchOptions<MessageHistoryQuery> }>();
  const page = (id: string, query: MessageHistoryQuery = {}): MessagingPage<DurableMessage> => {
    const rows = messages.filter(row => row.conversationId === id && (query.before === undefined || row.sequence < query.before) && (query.after === undefined || row.sequence > query.after))
      .sort((a, b) => query.after === undefined ? b.sequence - a.sequence : a.sequence - b.sequence);
    const items = rows.slice(0, query.limit ?? 50); return { items, hasMore: rows.length > items.length, nextCursor: rows.length > items.length ? String(items.at(-1)!.sequence) : null };
  };
  const mutable = {
    capabilities: async () => ({ enabled: true, directory: 'everyone', canSupport: false, maxMessageLength: 20000, maxParticipants: 100, maxUploadBytes: 16 * 1024 * 1024 }),
    conversations: { get: async (id: string) => workspaceConversation(id), people: async () => ({ items: [{ id: 'peer', name: 'Peer', kind: 'user', avatarUrl: null }], hasMore: false, nextCursor: null }),
      markRead: async (_id: string, sequence: number) => { reads.push(sequence); return { throughSequence: sequence, unreadCount: 0 }; } },
    messages: { list: async (id: string, query?: MessageHistoryQuery) => page(id, query), get: async (id: string, messageId: string) => messages.find(row => row.conversationId === id && row.id === messageId)!,
      send: async (id: string, input: any, options: MessagingMutationOptions) => { sends.push({ id, input, options }); const value = { ...workspaceMessage(messages.length + 1, id), text: input.text, authorId: 'me', visibility: input.visibility ?? 'conversation', attachmentIds: input.attachmentIds ?? [] }; messages.push(value); return value; } },
    attachments: { get: async () => { throw new Error('No synthetic attachment'); }, remove: async () => ({ removed: true }), allocate: async () => { throw new Error('No synthetic allocation'); } },
    receipt: async (_id: string): Promise<any> => null,
    watchConversations(listener: (page: MessagingPage<ConversationRecord>) => void, options: MessagingWatchOptions<any>) {
      const watch = { listener, options }; listWatchers.add(watch); queueMicrotask(() => { if (listWatchers.has(watch)) listener({ items: [workspaceConversation()], hasMore: false, nextCursor: null }); });
      return () => { listWatchers.delete(watch); };
    },
    watchMessages(id: string, listener: (page: MessagingPage<DurableMessage>) => void, options: MessagingWatchOptions<MessageHistoryQuery>) {
      const watch = { id, listener, options }; watchers.add(watch); queueMicrotask(() => { if (watchers.has(watch)) listener(page(id, options.query)); });
      return () => { watchers.delete(watch); };
    },
  };
  return { source: mutable as unknown as MessagingClient, mutable, messages, reads, sends, watchers, listWatchers, page,
    current: () => valid, retire: () => { valid = false; }, emit: () => { for (const watch of watchers) watch.listener(page(watch.id, watch.options.query)); } };
}
