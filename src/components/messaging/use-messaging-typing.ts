'use client';
/** Native durable-conversation typing facade. Private-note activity has its own staff-only topic. */
import { useConversationTyping, type UseConversationTypingOptions, type UseConversationTypingReturn } from './use-conversation-typing';
import { useClientMaybe } from '../../frontend/client/client-context';
import { messagingTypingLabel, messagingTypingRoom } from '../../messaging/typing-topic';
export function useMessagingTyping(conversationId: string, options: UseConversationTypingOptions & { visibility?: 'conversation' | 'staff' } = {}): UseConversationTypingReturn {
  const client = useClientMaybe();
  return useConversationTyping(messagingTypingRoom(conversationId, options.visibility), { ...options, label: messagingTypingLabel(client?.user ?? null, options.label) });
}
