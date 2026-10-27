/** Messaging presentation and real room typing; durable chat service is a separate implementation gate. */
export { MessagingLayout, type MessagingLayoutProps } from './messaging-layout';
export { ConversationList, ConversationListHeading, ConversationHeader, ConversationSeparator, type ConversationListProps, type ConversationListHeadingProps, type ConversationHeaderProps } from './conversation-parts';
export { MessageBubble, MessageDeliveryIndicator, type MessageBubbleProps, type MessageDeliveryIndicatorProps } from './message-bubble';
export { ConversationTypingIndicator, ConversationAssistantActivity, type ConversationTypingIndicatorProps, type ConversationAssistantActivityProps } from './conversation-activity';
export { MessagingComposer, type MessagingComposerProps, type MessagingComposerFile } from './messaging-composer';
export { useConversationTyping, type UseConversationTypingOptions, type UseConversationTypingReturn } from './use-conversation-typing';
export { useMessagingTyping } from './use-messaging-typing';
export { conversationActivityLabel, conversationActivityMembers, type ConversationActivityMember } from '../../messaging/activity';
export type * from '../../messaging/presentation';
