/** Pure authenticated destination selection; all policies were compiled by Guardian and minted into the current server actor. */
import type { ResolvedMessagingConfig } from './config';
import type { MessagingSupportInbox } from './contracts';
import type { MessagingActor } from './realm-model';
import { messagingFail, messagingText } from './validation';

/** The descriptor exposes only safe display and current-user booleans, never policy definitions or private staff identities. */
export function messagingSupportInboxes(config: ResolvedMessagingConfig, actor: MessagingActor): readonly MessagingSupportInbox[] {
  return Object.values(config.supportInboxes ?? {}).flatMap(inbox => {
    const canOpen = actor.inboxPolicies?.[inbox.id] === inbox.policyHash, canHandle = actor.staff && actor.inboxStaffPolicies?.[inbox.id] === inbox.policyHash;
    if (!canOpen && !canHandle) return [];
    return [{ id: inbox.id, title: inbox.title, canOpen, canHandle,
      assistant: !!inbox.assistantId && !!actor.assistantPolicies?.[inbox.assistantId], default: config.defaultSupportInbox === inbox.id }];
  });
}
/** An omitted destination can use only the explicit default; a caller cannot choose a staff ID, tenant or public visitor entry. */
export function selectMessagingSupportInbox(config: ResolvedMessagingConfig, actor: MessagingActor, requested: unknown) {
  const id = requested === undefined ? config.defaultSupportInbox : messagingText(requested, 64);
  if (id === null || id === undefined) {
    if (Object.keys(config.supportInboxes ?? {}).length) messagingFail('MESSAGING_INPUT_INVALID', 422);
    return null;
  }
  const inbox = config.supportInboxes?.[id];
  if (!inbox || actor.inboxPolicies?.[id] !== inbox.policyHash) messagingFail('MESSAGING_NOT_FOUND', 404);
  return inbox;
}
