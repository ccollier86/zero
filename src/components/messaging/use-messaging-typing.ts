'use client';
/** Native durable-conversation typing facade. Private-note activity has its own staff-only topic. */
import { useConversationTyping, type UseConversationTypingOptions, type UseConversationTypingReturn } from './use-conversation-typing';
export function useMessagingTyping(conversationId: string, options: UseConversationTypingOptions & { visibility?: 'conversation' | 'staff' } = {}): UseConversationTypingReturn {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(conversationId)) throw new Error('A real messaging conversation id is required.');
  return useConversationTyping('messaging:' + conversationId + (options.visibility === 'staff' ? ':staff' : ''), options);
}
