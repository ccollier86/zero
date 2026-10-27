/** Browser-safe messaging workspace, composable parts and native typing/presence integration. */
export { MessagingLayout, type MessagingLayoutProps } from './messaging-layout';
export { ConversationList, ConversationListHeading, ConversationHeader, ConversationSeparator, type ConversationListProps, type ConversationListHeadingProps, type ConversationHeaderProps } from './conversation-parts';
export { MessageBubble, NativeMessageBubble, MessageDeliveryIndicator, type MessageBubbleProps, type NativeMessageBubbleProps, type MessageDeliveryIndicatorProps } from './message-bubble';
export { ConversationTypingIndicator, ConversationAssistantActivity, type ConversationTypingIndicatorProps, type ConversationAssistantActivityProps } from './conversation-activity';
export { MessagingComposer, type MessagingComposerProps, type MessagingComposerFile } from './messaging-composer';
export { useConversationTyping, type UseConversationTypingOptions, type UseConversationTypingReturn } from './use-conversation-typing';
export { useMessagingTyping } from './use-messaging-typing';
export { useMessagingPresence } from './use-messaging-presence';
export { MessagingLiveError } from '../../messaging/live-error';
export { MessagingWorkspace, type MessagingWorkspaceProps } from './messaging-workspace';
export { useMessagingWorkspace, type UseMessagingWorkspaceOptions } from './use-messaging-workspace';
export { MessagingWorkspaceController } from './messaging-workspace-controller';
export type { MessagingWorkspaceState, MessagingWorkspaceDraft, MessagingWorkspaceUpload, MessagingWorkspaceControllerOptions } from './workspace-state';
export { conversationActivityLabel, conversationActivityMembers, type ConversationActivityMember } from '../../messaging/activity';
export type * from '../../messaging/presentation';
