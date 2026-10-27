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
import { messagingHash, messagingId } from './validation';
import type { MessagingJobRow, MessagingJobState } from './job-model';
import { TERMINAL_MESSAGING_JOBS } from './job-model';
import { AuthError } from '../auth/types';
export interface MessagingJobContext {
  job: MessagingJobRow; valid: boolean; customerId: string | null; customerKind: 'user' | 'external' | 'assistant' | null;
  attachmentOnly: boolean; messages: { role: 'user' | 'assistant'; content: string }[]; result: { text: string; provider_id: string | null } | null;
}
export interface MessagingJobExecutionDependencies {
  runtime: MessagingRuntime; config: ResolvedMessagingConfig; directory: MessagingDirectory; ai: AIService | null; logging: LoggingRuntime | null;
  assertOpen(): void;
}
export async function executeMessagingJob(deps: MessagingJobExecutionDependencies, context: StepContext<{ jobId: string }>, signal: AbortSignal): Promise<{ jobId: string; state: MessagingJobState }> {
  const jobId = messagingId(context.input.jobId), scope: ServiceDataScope = trustedSystemServiceDataScope(context.execution.scopeKind === 'tenant'
    ? { scopeKind: 'tenant', tenantId: context.execution.tenantId! } : { scopeKind: 'application' });
  const scopeId = serviceDataScopeKey(scope), nonce = 'attempt_' + crypto.randomUUID(), policy = deps.config.assistant;
  const base = () => { deps.assertOpen(); deps.directory.assertScope(scope); context.assertCurrentAuthority(); };
  const check = () => { base(); signal.throwIfAborted(); };
  const read = () => deps.runtime.read<MessagingJobContext>(scope, 'messaging.job.context', { scopeId, id: jobId }, check, signal);
  const write = <T>(name: string, input: object, assert = check) => deps.runtime.write<T>(scope, name, { ...input, scopeId, id: jobId, nonce }, 'job:' + messagingHash([jobId, nonce, name]), assert, signal);
  const result = (state: MessagingJobState) => ({ jobId, state });
  const run = async () => {
    const claimed = await write<{ state: MessagingJobState }>('messaging.job.claim', { policyHash: policy ? policy.policyHash : null, leaseMs: (policy ? policy.timeoutMs : 120000) + 10000 });
    if (TERMINAL_MESSAGING_JOBS.has(claimed.state)) return result(claimed.state);
    let captured = await read();
    let failureCode = 'ADMISSION_REQUIRES_REVIEW';
    const current = () => { check(); if (captured.customerKind === 'user' && captured.customerId) deps.directory.assertRecipient(scope, captured.customerId); };
    try {
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
        const response = await deps.ai.generateText({ model: policy.model, instructions: policy.instructions, messages: captured.messages,
          maxOutputTokens: policy.maxOutputTokens, maxRetries: 0, abortSignal: AbortSignal.any([signal, AbortSignal.timeout(policy.timeoutMs)]) });
        current(); failureCode = 'RESULT_REQUIRES_REVIEW';
        const providerId = typeof response.response.id === 'string' && response.response.id.length <= 200 ? response.response.id : null;
        const received = await write<{ state: MessagingJobState }>('messaging.job.receive', { text: response.text, providerId, maxMessageLength: deps.config.maxMessageLength }, current);
        if (received.state !== 'received') return result(received.state);
      }
      captured = await read(); current(); failureCode = 'PUBLICATION_REQUIRES_REVIEW';
      const published = await write<{ state: MessagingJobState }>('messaging.job.publish', { notificationsEnabled: deps.config.notifications }, current);
      return result(published.state);
    } catch (failure) {
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
