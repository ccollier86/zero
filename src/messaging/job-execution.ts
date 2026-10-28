/** One Torrent activity around the real Zero AI gateway. Invocation uncertainty never silently becomes another provider call. */
import type { AIService } from '../ai/ai-service';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { StepContext } from '../workflows/types';
import type { ResolvedMessagingConfig } from './config';
import type { MessagingRuntime } from './runtime';
import type { MessagingDirectory } from './service';
import type { LoggingRuntime } from '../logging/logging-runtime';
import { runWithLoggingAttribution } from '../logging/logging-attribution';
import { messagingHash, messagingId, messagingRecord } from './validation';
import { aiTool, defineAITools } from '../ai/ai-toolkit';
import type { MessagingJobRow, MessagingJobState } from './job-model';
import { TERMINAL_MESSAGING_JOBS } from './job-model';
import { AuthError } from '../auth/types';
import type { ReactiveDB } from '../sync/reactive-db';
import type { NotificationService } from '../notifications/notification-service';
import { executeMessagingNotification } from './notification-execution';
export interface MessagingJobContext {
  job: MessagingJobRow; valid: boolean; customerId: string | null; customerKind: 'user' | 'external' | 'assistant' | null;
  conversationKind?: string | null; assistantId?: string;
  supportEntryId?: string | null; visitorPolicyHash?: string | null; visitorExpiresAt?: number | null;
  attachmentOnly: boolean; messages: { role: 'user' | 'assistant'; content: string }[]; result: { text: string; provider_id: string | null } | null;
}
export interface MessagingJobExecutionDependencies {
  runtime: MessagingRuntime; config: ResolvedMessagingConfig; directory: MessagingDirectory; ai: AIService | null; logging: LoggingRuntime | null;
  system: ReactiveDB; notifications: NotificationService | null;
  assertOpen(): void;
}
export async function executeMessagingJob(deps: MessagingJobExecutionDependencies, context: StepContext<{ jobId: string }>, signal: AbortSignal): Promise<{ jobId: string; state: MessagingJobState }> {
  const jobId = messagingId(context.input.jobId), scope: ServiceDataScope = trustedSystemServiceDataScope(context.execution.scopeKind === 'tenant'
    ? { scopeKind: 'tenant', tenantId: context.execution.tenantId! } : { scopeKind: 'application' });
  const scopeId = serviceDataScopeKey(scope), nonce = 'attempt_' + crypto.randomUUID();
  const base = () => { deps.assertOpen(); deps.directory.assertScope(scope); context.assertCurrentAuthority(); };
  const check = () => { base(); signal.throwIfAborted(); };
  const read = () => deps.runtime.read<MessagingJobContext>(scope, 'messaging.job.context', { scopeId, id: jobId }, check, signal);
  const write = <T>(name: string, input: object, assert = check) => deps.runtime.write<T>(scope, name, { ...input, scopeId, id: jobId, nonce }, 'job:' + messagingHash([jobId, nonce, name]), assert, signal);
  const result = (state: MessagingJobState) => ({ jobId, state });
  const run = async () => {
    const initial = await read(), assistantId = initial.assistantId ?? initial.job.assistant_id ?? 'default';
    const policy = deps.config.assistants[assistantId] ?? false;
    const claimed = await write<{ state: MessagingJobState }>('messaging.job.claim', { policyHash: policy ? policy.policyHash : null, leaseMs: (policy ? policy.timeoutMs : 120000) + 10000 });
    if (TERMINAL_MESSAGING_JOBS.has(claimed.state)) return result(claimed.state);
    let captured = await read();
    let failureCode = 'ADMISSION_REQUIRES_REVIEW';
    const current = () => {
      check();
      if (captured.supportEntryId && captured.customerKind === 'external') {
        const entry = deps.config.supportEntries[captured.supportEntryId];
        if (!entry || entry.tenantId !== scope.tenantId || entry.assistantId !== assistantId || entry.policyHash !== captured.visitorPolicyHash || !captured.visitorExpiresAt || captured.visitorExpiresAt <= Date.now()) throw new AuthError('Public support admission changed.', 'MESSAGING_FORBIDDEN', 403);
      }
      if (captured.customerKind === 'user' && captured.customerId) {
        deps.directory.assertRecipient(scope, captured.customerId);
        if (captured.conversationKind === 'assistant' && deps.directory.assistantRecipient?.(scope, captured.customerId, assistantId) !== true) throw new AuthError('Messaging assistant access changed.', 'MESSAGING_FORBIDDEN', 403);
      }
    };
    try {
      if (captured.job.kind === 'notification') { failureCode = 'NATIVE_NOTIFICATION_REQUIRES_REVIEW'; return await executeMessagingNotification(deps, context, scope, jobId, nonce, signal); }
      current();
      if (captured.job.kind !== 'assistant' || !policy || !deps.ai || captured.attachmentOnly || !captured.messages.length) {
        const review = await write<{ state: MessagingJobState }>('messaging.job.review', { code: captured.attachmentOnly ? 'ATTACHMENT_REQUIRES_REVIEW' : captured.job.kind === 'assistant' ? 'ASSISTANT_NOT_READY' : 'DELIVERY_NOT_READY' });
        return result(review.state);
      }
      // A saved provider result resumes finalization; it does not incur a new
      // generation just because the prior process ended before publication.
      if (claimed.state !== 'received') {
        const calling = await write<{ state: MessagingJobState }>('messaging.job.call', {}, current);
        if (calling.state !== 'calling') return result(calling.state);
        current(); failureCode = 'PROVIDER_OUTCOME_UNKNOWN';
        const handoff = policy.humanHandoff && captured.conversationKind === 'support';
        const tools = handoff ? defineAITools({ requestHuman: aiTool({ description: 'Request an authorized human support team member for this same conversation when the customer asks for a person or you cannot safely help. This only enters the waiting queue; it does not assign a person or send a reply.', input: { type: 'object', properties: {}, additionalProperties: false } }) }) : undefined;
        const response = await deps.ai.generateText({ model: policy.model, instructions: policy.instructions, messages: captured.messages,
          ...(tools ? { tools } : {}), maxOutputTokens: policy.maxOutputTokens, maxRetries: 0, abortSignal: AbortSignal.any([signal, AbortSignal.timeout(policy.timeoutMs)]) });
        current(); failureCode = 'RESULT_REQUIRES_REVIEW';
        const providerId = typeof response.response.id === 'string' && response.response.id.length <= 200 ? response.response.id : null;
        if (response.toolCalls.length) {
          if (!handoff || response.toolCalls.length !== 1 || response.toolCalls[0]!.toolName !== 'requestHuman') throw new AuthError('The assistant result requires review.', 'MESSAGING_JOB_CONFLICT', 409);
          messagingRecord(response.toolCalls[0]!.input, []);
          const transferred = await write<{ state: MessagingJobState }>('messaging.job.handoff', { policyHash: policy.policyHash, providerId }, current);
          return result(transferred.state);
        }
        const received = await write<{ state: MessagingJobState }>('messaging.job.receive', { text: response.text, providerId, maxMessageLength: deps.config.maxMessageLength }, current);
        if (received.state !== 'received') return result(received.state);
      }
      captured = await read(); current(); failureCode = 'PUBLICATION_REQUIRES_REVIEW';
      const published = await write<{ state: MessagingJobState }>('messaging.job.publish', { notificationsEnabled: deps.config.notifications, notificationPath: deps.config.notificationPath }, current);
      return result(published.state);
    } catch (failure) {
      // Native receiver effects alone have permanent destination idempotency.
      // Let Torrent retain the failed attempt so its bounded generation
      // reconciler can safely replay that same effect. Known schema/input
      // conflicts still go directly to review; external calls never use this.
      if (captured.job.kind === 'notification' && deps.config.notifications && deps.notifications
        && !(failure instanceof AuthError && ['NOTIFICATION_NOT_READY', 'NOTIFICATION_INPUT_INVALID', 'NOTIFICATION_EFFECT_CONFLICT'].includes(failure.code))) {
        throw new AuthError('The native messaging notification requires safe receipt reconciliation.', 'MESSAGING_NATIVE_NOTIFICATION_DEFERRED', 503);
      }
      // Never put provider exception text, prompts or results in workflow error
      // fields. An interrupted invocation remains a durable review fact.
      try {
        const review = await deps.runtime.write<{ state: MessagingJobState }>(scope, 'messaging.job.review', { scopeId, id: jobId, nonce, code: signal.aborted ? 'ACTIVITY_INTERRUPTED' : failureCode }, 'job-review:' + messagingHash([jobId, nonce]), base);
        return result(review.state);
      } catch { throw new AuthError('The private messaging job requires reconciliation.', 'MESSAGING_JOB_RECONCILIATION_REQUIRED', 503); }
    }
  };
  return deps.logging ? runWithLoggingAttribution(deps.logging, { sourceId: 'messaging-job:' + messagingHash(jobId).slice(0, 40), origin: 'system',
    scope: scope.tenantId === null ? { kind: 'application', tenantId: null } : { kind: 'tenant', tenantId: scope.tenantId },
    actor: { kind: 'system', id: MESSAGING_SYSTEM_ACTOR, sessionId: null, initiatorId: null }, requestId: jobId, correlationId: context.instanceId, policyVersion: deps.logging.config.policyVersion }, base, run) : run();
}
const MESSAGING_SYSTEM_ACTOR = 'zero.messaging';
