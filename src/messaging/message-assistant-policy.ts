/** Actor-local bot selection. A registry grant is not permission to reactivate disabled support automation or another inbox's bot. */
import type { MessagingActor, ConversationRow } from './realm-model';
import { messagingCatalogId, messagingRegistry } from './validation';

/** Select only the conversation's configured bot; HTTP callers cannot supply these server-owned selections. */
export function messagingMessageAssistantPolicy(actor: MessagingActor, conversation: ConversationRow, legacy: unknown, selections: unknown): unknown {
  if (conversation.kind === 'assistant') return actor.assistantPolicies?.[conversation.assistant_id!] ?? null;
  if (conversation.kind !== 'support') return null;
  if (actor.kind === 'user' && conversation.support_entry_id && !conversation.visitor_session_id) {
    const inboxes = messagingRegistry(selections ?? {}, 32);
    for (const [id, assistant] of Object.entries(inboxes)) { messagingCatalogId(id); messagingCatalogId(assistant); }
    if (inboxes[conversation.support_entry_id] !== conversation.assistant_id) return null;
    return actor.assistantPolicies?.[conversation.assistant_id!] ?? null;
  }
  if (actor.kind !== 'user' || actor.assistantPolicies === undefined) return legacy;
  const current = actor.assistantPolicies[conversation.assistant_id ?? 'default'];
  return current && current === legacy ? current : null;
}
