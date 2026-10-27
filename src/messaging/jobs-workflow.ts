/** Fixed, versioned Torrent entry. Inputs/results are opaque job identities and safe state only, never transcript or generated text. */
import type { WorkflowRegistry } from '../workflows/workflow-registry';
import type { StepContext } from '../workflows/types';
import { WorkflowError } from '../workflows/workflow-error';
import { messagingId, messagingRecord } from './validation';
import type { MessagingJobState } from './job-model';
export const MESSAGING_JOB_WORKFLOW = 'zero.messaging.job.v1';
export const MESSAGING_JOB_PRINCIPAL = 'zero.messaging';
export interface MessagingJobExecution { execute(context: StepContext<{ jobId: string }>): Promise<{ jobId: string; state: MessagingJobState }> }
export function registerMessagingJobWorkflow(registry: WorkflowRegistry, service: () => MessagingJobExecution): void {
  registry.registerHandler(MESSAGING_JOB_WORKFLOW, async (context: StepContext<{ jobId: string }>) => {
    if (context.execution.kind !== 'system' || context.execution.principal !== MESSAGING_JOB_PRINCIPAL || context.execution.legacyCompatibility) throw new WorkflowError('Messaging jobs require their sealed system execution.', 'WORKFLOW_AUTHORITY_REQUIRED', 403);
    const input = messagingRecord(context.input, ['jobId']); messagingId(input.jobId); context.assertCurrentAuthority();
    return service().execute(context);
  });
  registry.create({ name: MESSAGING_JOB_WORKFLOW, access: { start: 'admin', inspect: 'admin' },
    steps: [{ name: 'Execute private messaging job', handler: MESSAGING_JOB_WORKFLOW, retries: 1, timeoutMs: 360000 }] });
}
