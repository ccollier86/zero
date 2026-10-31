/** Receiver-stage unit checks with explicit I/O doubles. Native job receipts and HTTP are qualified by separate integration tests. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import type { StepContext } from '../workflows/types';
import type { MessagingJobExecutionDependencies } from './job-execution';
import type { MessagingNotificationContext } from './notification-queries';
import { executeMessagingNotification } from './notification-execution';

test.each(['public', 'inbox'] as const)('notification receiver admission cannot substitute the opposite destination namespace (%s)', async origin => {
  const system = createReactiveDB({ mode: 'memory' }), scope = applicationServiceDataScope();
  let admittedOrigin: string = origin === 'public' ? 'inbox' : 'public', accepted: string[] = [];
  const source: MessagingNotificationContext = { job: { id: 'job', scope_id: 'application', conversation_id: 'conversation', message_id: 'message', kind: 'notification',
      owner_epoch: 1, context_revision: 1, policy_hash: null, dispatch_generation: 0, state: 'claimed', lease_nonce: 'nonce', lease_expires: 60000,
      attempts: 1, provider_id: null, error_code: null, created_at: 1, updated_at: 1 }, audiencePresent: true, available: true, path: '/messages',
    recipients: [{ id: 'operator', staff: true }], currentRecipientIds: ['operator'], conversationKind: 'support',
    inboxId: origin === 'inbox' ? 'team' : null, supportEntryId: origin === 'public' ? 'team' : null };
  const check = () => {};
  const deps = { system, config: { notifications: true }, assertOpen: check,
    directory: { assertScope: check, notificationRecipient: () => true,
      inboxStaffRecipient: () => admittedOrigin === 'inbox', supportRecipient: () => admittedOrigin === 'public' },
    runtime: { read: async () => source, write: async (_scope: unknown, name: string) => ({ state: name === 'messaging.job.call' ? 'calling' : 'accepted' }) },
    notifications: { notifyUsersOnce(_key: string, ids: readonly string[], _body: unknown, _sender: unknown, _scope: unknown, current: () => void, admit: (id: string) => boolean) {
      current(); accepted = ids.filter(admit); return { notificationId: 'synthetic-notice' };
    } },
  } as unknown as MessagingJobExecutionDependencies;
  const context = { assertCurrentAuthority: check } as unknown as StepContext<{ jobId: string }>;
  try {
    await executeMessagingNotification(deps, context, scope, 'job', 'nonce', new AbortController().signal); expect(accepted).toEqual([]);
    admittedOrigin = origin;
    await executeMessagingNotification(deps, context, scope, 'job', 'another-nonce', new AbortController().signal); expect(accepted).toEqual(['operator']);
  } finally { system.dispose(); }
});
