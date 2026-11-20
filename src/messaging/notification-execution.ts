/** Native notice receiver orchestration. Fixed source candidates plus permanent SYSTEM receipts make crash replay safe without cross-file transaction fiction. */
import type { StepContext } from '../workflows/types';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import type { MessagingJobExecutionDependencies } from './job-execution';
import type { MessagingJobState } from './job-model';
import type { MessagingNotificationContext } from './notification-queries';
import { messagingHash } from './validation';

/** Acceptance means a native effect receipt (possibly an empty audience), never human read or external-provider delivery. */
export async function executeMessagingNotification(deps: MessagingJobExecutionDependencies, context: StepContext<{ jobId: string }>, scope: ServiceDataScope,
  jobId: string, nonce: string, signal: AbortSignal): Promise<{ jobId: string; state: MessagingJobState }> {
  const scopeId = serviceDataScopeKey(scope), check = () => { deps.assertOpen(); deps.directory.assertScope(scope); context.assertCurrentAuthority(); signal.throwIfAborted(); };
  const input = { scopeId, id: jobId, nonce }, key = (stage: string) => 'notice:' + messagingHash([jobId, nonce, stage]);
  if (!deps.config.notifications || !deps.notifications) {
    const result = await deps.runtime.write<{ state: MessagingJobState }>(scope, 'messaging.job.review', { ...input, code: 'NOTIFICATIONS_DISABLED' }, key('disabled'), check, signal);
    return { jobId, state: result.state };
  }
  const read = () => deps.runtime.read<MessagingNotificationContext>(scope, 'messaging.notification.context', { scopeId, id: jobId }, check, signal);
  if (!(await read()).audiencePresent) {
    const result = await deps.runtime.write<{ state: MessagingJobState }>(scope, 'messaging.job.review', { ...input, code: 'NOTIFICATION_AUDIENCE_REQUIRES_REVIEW' }, key('audience'), check, signal);
    return { jobId, state: result.state };
  }
  const calling = await deps.runtime.write<{ state: MessagingJobState }>(scope, 'messaging.job.call', input, key('call'), check, signal);
  if (calling.state !== 'calling') return { jobId, state: calling.state };
  const source = await read();
  if (!source.audiencePresent || source.path === null) throw new Error('The accepted native notification audience is unavailable.');
  const members = new Set(source.currentRecipientIds), recipients = new Map(source.recipients.map(recipient => [recipient.id, recipient]));
  const accepted = new Set<string>();
  const allowed = (id: string, related?: ReadonlySet<string>) => {
    const recipient = recipients.get(id);
    return !!recipient && members.has(id) && (related ? related.has(id) : !source.relationshipEpoch)
      && deps.directory.notificationRecipient(scope, id, recipient.staff, source.conversationKind)
      && (!source.inboxId || (recipient.staff ? deps.directory.inboxStaffRecipient?.(scope, id, source.inboxId) === true : deps.directory.inboxRecipient?.(scope, id, source.inboxId) === true))
      && (!source.supportEntryId || !recipient.staff || deps.directory.supportRecipient?.(scope, id, source.supportEntryId) === true)
      && (!source.managedGroupId || related !== undefined || deps.directory.groupRecipient?.(scope, id, source.managedGroupId) === true)
      && (!source.internalAssistantId || deps.directory.assistantRecipient?.(scope, id, source.internalAssistantId) === true);
  };
  const receipt = await withReactiveDBCommitAdmission(deps.system, () => {
    check();
    const related = deps.directory.relationshipRecipients?.(scope, source);
    return deps.notifications!.notifyUsersOnce('zero.messaging:' + jobId, source.recipients.map(recipient => recipient.id),
      { title: 'New message', actionUrl: source.path + '?conversation=' + encodeURIComponent(source.job.conversation_id),
        presentation: { kind: 'chat', conversationId: source.job.conversation_id, messageId: source.job.message_id } }, undefined, scope, check,
      id => {
        if (!allowed(id, related)) return false;
        accepted.add(id);
        return true;
      });
  }, { signal });
  const result = await deps.runtime.write<{ state: MessagingJobState }>(scope, 'messaging.notification.complete', { ...input, notificationId: receipt.notificationId }, key('complete'), check, signal);
  if (receipt.notificationId && receipt.retained && !receipt.duplicate && accepted.size && deps.config.onNoticeAccepted && !signal.aborted) {
    const delivery = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    try {
      await deps.config.onNoticeAccepted({ notificationId: receipt.notificationId, scope, userIds: [...accepted] }, {
        signal: delivery,
        isCurrentRecipient(id) {
          if (!accepted.has(id) || delivery.aborted) return false;
          try { check(); return allowed(id, deps.directory.relationshipRecipients?.(scope, source)); }
          catch { return false; }
        },
      });
    } catch { /* This delivery is best effort. The accepted native notice remains canonical. */ }
  }
  return { jobId, state: result.state };
}
