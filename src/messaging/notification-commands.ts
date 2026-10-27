/** Native receipt completion/recovery only. No external provider is safely retried by these commands. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { messagingCommand } from './realm-errors';
import { finishJobAttempt, jobInScope, TERMINAL_MESSAGING_JOBS } from './job-model';
import { messagingFail, messagingId, messagingInteger, messagingRecord } from './validation';

export function completeMessagingNotification(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['scopeId', 'id', 'nonce', 'notificationId']), job = jobInScope(context, r.id, r.scopeId);
    if (job.kind !== 'notification') messagingFail('MESSAGING_JOB_CONFLICT');
    if (job.state === 'accepted') return { state: 'accepted' };
    if (job.state !== 'calling' || job.lease_nonce !== messagingId(r.nonce) || !job.lease_expires || job.lease_expires <= Date.now() || !context.db.get('messaging_notification_audiences', job.id)) messagingFail('MESSAGING_JOB_CONFLICT');
    const notificationId = r.notificationId === null ? null : messagingId(r.notificationId);
    finishJobAttempt(context, job, 'completed', null, notificationId);
    context.db.update('messaging_jobs', job.id, { state: 'accepted', provider_id: notificationId, error_code: null, lease_nonce: null, lease_expires: null, updated_at: Date.now() });
    return { state: 'accepted' };
  });
}
/** A failed Torrent instance can create a new native-only dispatch, protected by the receiver's permanent effect receipt. */
export function redispatchMessagingNotification(context: DatabaseWriteCommandContext, input: unknown): unknown {
  return messagingCommand(context, () => {
    const r = messagingRecord(input, ['scopeId', 'id', 'generation', 'workflowId']), job = jobInScope(context, r.id, r.scopeId), generation = messagingInteger(r.generation, 0);
    if (job.kind !== 'notification' || !context.db.get('messaging_notification_audiences', job.id)) messagingFail('MESSAGING_JOB_CONFLICT');
    if (TERMINAL_MESSAGING_JOBS.has(job.state)) return { state: job.state };
    const dispatch = context.db.get('messaging_job_dispatches', job.id + ':' + generation);
    if (!dispatch || dispatch.workflow_id !== messagingId(r.workflowId) || job.dispatch_generation !== generation) messagingFail('MESSAGING_JOB_CONFLICT');
    if (generation >= 2) messagingFail('MESSAGING_JOB_CONFLICT');
    finishJobAttempt(context, job, 'unknown', 'NATIVE_NOTIFICATION_RECONCILIATION');
    context.db.update('messaging_jobs', job.id, { state: 'pending', dispatch_generation: generation + 1, lease_nonce: null, lease_expires: null, updated_at: Date.now() });
    return { state: 'pending' };
  });
}
