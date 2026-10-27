/** Browser-safe SDK additions. Watches carry authorized bounded projections, never table access or authority selectors. */
import type { ConversationQuery, ConversationRecord, DurableMessage, MessageHistoryQuery, MessagingApi, MessagingPage } from './contracts';
export type MessagingConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';
export interface MessagingWatchOptions<Q> { readonly query?: Q; readonly signal?: AbortSignal; onError?(error: unknown): void; onConnection?(state: MessagingConnectionState): void }
export interface MessagingClient extends MessagingApi {
  clear(): void;
  watchConversations(listener: (page: MessagingPage<ConversationRecord>) => void, options?: MessagingWatchOptions<ConversationQuery>): () => void;
  watchMessages(conversationId: string, listener: (page: MessagingPage<DurableMessage>) => void, options?: MessagingWatchOptions<MessageHistoryQuery>): () => void;
}
export type * from './contracts';
