/** Browser-safe durable messaging contracts. Identifiers and display data never confer access. */
export const MESSAGING_API = '/api/messaging';
import type { MessagingAttachmentsApi } from './attachment-contracts';
export interface MessagingMutationOptions { readonly requestId: string; readonly signal?: AbortSignal }
export interface MessagingReadOptions { readonly signal?: AbortSignal }
export type ConversationKind = 'direct' | 'group' | 'support';
export type ConversationRole = 'owner' | 'member' | 'staff' | 'customer';
export type ConversationOwner = 'triage' | 'human' | 'assistant';
export const MESSAGING_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🙏', '✅'] as const;
export interface ConversationParticipant { readonly id: string; readonly kind: 'user' | 'external'; readonly role: ConversationRole; readonly joinedAt: number }
export interface ConversationRecord {
  readonly id: string; readonly kind: ConversationKind; readonly title: string; readonly revision: number;
  readonly createdAt: number; readonly updatedAt: number; readonly archived: boolean;
  readonly owner: ConversationOwner; readonly ownerId: string | null; readonly ownerEpoch: number;
  readonly participants: readonly ConversationParticipant[];
  readonly lastMessage: (DurableMessage & { readonly truncated: boolean }) | null; readonly unreadCount: number;
}
/** Sequence is the caller's visible timeline, not a hidden staff-note/global ingestion ordinal. */
export interface DurableMessage {
  readonly id: string; readonly conversationId: string; readonly sequence: number; readonly revision: number;
  readonly authorId: string; readonly authorKind: 'user' | 'external' | 'assistant';
  readonly visibility: 'conversation' | 'staff'; readonly text: string; readonly createdAt: number;
  readonly editedAt: number | null; readonly deleted: boolean; readonly attachmentIds: readonly string[];
  readonly reactions: readonly { readonly emoji: string; readonly count: number; readonly selected: boolean }[];
}
export interface MessagingPage<T> { readonly items: readonly T[]; readonly hasMore: boolean; readonly nextCursor: string | null }
export interface MessageHistoryQuery { readonly before?: number; readonly after?: number; readonly limit?: number; readonly search?: string }
export interface ConversationQuery { readonly after?: string; readonly limit?: number; readonly archived?: boolean }
export interface MessagingCapabilities { readonly enabled: boolean; readonly directory: 'everyone' | 'contacts'; readonly canSupport: boolean; readonly maxMessageLength: number; readonly maxParticipants: number; readonly maxUploadBytes: number;
  /** Configuration/capability, not a provider-delivery or current network-health claim. */
  readonly assistant?: boolean; readonly notifications?: boolean }
export interface MessagingDirectoryEntry { readonly id: string; readonly name: string; readonly avatarUrl: string | null }
/** Reconciles an uncertain command without returning a message body after membership removal. */
export interface MessagingReceipt { readonly requestId: string; readonly operation: string; readonly resourceId: string | null; readonly acceptedAt: number }
export interface MessagingContact { readonly id: string; readonly userId: string; readonly direction: 'incoming' | 'outgoing'; readonly state: 'pending' | 'accepted' | 'declined' | 'blocked'; readonly revision: number; readonly updatedAt: number }
export interface MessagingApi {
  readonly attachments: MessagingAttachmentsApi;
  capabilities(): Promise<MessagingCapabilities>;
  directory(query?: { readonly after?: string; readonly limit?: number; readonly search?: string }, options?: MessagingReadOptions): Promise<MessagingPage<MessagingDirectoryEntry>>;
  receipt(requestId: string, options?: MessagingReadOptions): Promise<MessagingReceipt | null>;
  conversations: {
    list(query?: ConversationQuery, options?: MessagingReadOptions): Promise<MessagingPage<ConversationRecord>>;
    get(id: string, options?: MessagingReadOptions): Promise<ConversationRecord>;
    create(input: { readonly kind?: 'direct' | 'group'; readonly title?: string; readonly userIds: readonly string[] }, options: MessagingMutationOptions): Promise<ConversationRecord>;
    rename(id: string, expectedRevision: number, title: string, options: MessagingMutationOptions): Promise<ConversationRecord>;
    archive(id: string, expectedRevision: number, archived: boolean, options: MessagingMutationOptions): Promise<ConversationRecord>;
    addParticipant(id: string, expectedRevision: number, userId: string, options: MessagingMutationOptions): Promise<ConversationRecord>;
    removeParticipant(id: string, expectedRevision: number, participantId: string, options: MessagingMutationOptions): Promise<{ readonly removed: true }>;
    markRead(id: string, throughSequence: number, options: MessagingMutationOptions): Promise<{ readonly throughSequence: number; readonly unreadCount: number }>;
    takeover(id: string, expectedEpoch: number, options: MessagingMutationOptions): Promise<ConversationRecord>;
    handBack(id: string, expectedEpoch: number, owner: 'assistant' | 'triage', options: MessagingMutationOptions): Promise<ConversationRecord>;
  };
  messages: {
    list(conversationId: string, query?: MessageHistoryQuery, options?: MessagingReadOptions): Promise<MessagingPage<DurableMessage>>;
    send(conversationId: string, input: { readonly text: string; readonly attachmentIds?: readonly string[]; readonly visibility?: 'conversation' | 'staff'; readonly expectedOwnerEpoch?: number }, options: MessagingMutationOptions): Promise<DurableMessage>;
    edit(conversationId: string, id: string, expectedRevision: number, text: string, options: MessagingMutationOptions): Promise<DurableMessage>;
    remove(conversationId: string, id: string, expectedRevision: number, options: MessagingMutationOptions): Promise<DurableMessage>;
    react(conversationId: string, id: string, emoji: string, selected: boolean, options: MessagingMutationOptions): Promise<DurableMessage>;
  };
  contacts: {
    list(query?: { readonly after?: string; readonly limit?: number }, options?: MessagingReadOptions): Promise<MessagingPage<MessagingContact>>;
    request(userId: string, options: MessagingMutationOptions): Promise<MessagingContact>;
    respond(userId: string, expectedRevision: number, accept: boolean, options: MessagingMutationOptions): Promise<MessagingContact>;
    block(userId: string, options: MessagingMutationOptions): Promise<MessagingContact>;
    unblock(userId: string, options: MessagingMutationOptions): Promise<{ readonly unblocked: true }>;
  };
  support: {
    open(input: { readonly title?: string }, options: MessagingMutationOptions): Promise<ConversationRecord>;
    queue(query?: { readonly after?: string; readonly limit?: number }, options?: MessagingReadOptions): Promise<MessagingPage<{ readonly id: string; readonly owner: ConversationOwner; readonly ownerEpoch: number; readonly createdAt: number }>>;
    claim(id: string, expectedEpoch: number, options: MessagingMutationOptions): Promise<ConversationRecord>;
  };
}
