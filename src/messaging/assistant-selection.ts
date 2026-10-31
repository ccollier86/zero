/** Service-layer bot selection from canonical private routing metadata, not participant display fields. Guardian still owns admission. */
import type { ResolvedMessagingConfig } from './config';
import type { ConversationKind } from './contracts';

/** Internal bounded actor projection; never returned by the public conversation API. */
export interface MessagingAssistantRoute { readonly kind: ConversationKind; readonly assistantId: string | null; readonly entryId: string | null; readonly visitor: boolean }

/** Keep an existing bot identity pinned and honor current support/inbox/public-entry selection before a human restart. */
export function selectMessagingConversationAssistant(config: ResolvedMessagingConfig, route: MessagingAssistantRoute) {
  if (route.kind !== 'support' && route.kind !== 'assistant') return undefined;
  const id = route.assistantId ?? (route.kind === 'support' && config.assistant ? config.assistant.id : null);
  if (route.kind === 'support') {
    if (!config.support) return undefined;
    const selected = route.entryId ? route.visitor ? config.supportEntries[route.entryId]?.assistantId : config.supportInboxes[route.entryId]?.assistantId
      : config.assistant ? config.assistant.id : null;
    if (!id || id !== selected) return undefined;
  }
  return id ? config.assistants[id] : undefined;
}
