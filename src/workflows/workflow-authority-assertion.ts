/** Reject asynchronous commit fences without executing user-authored then getters. */
import { WorkflowError } from './workflow-error';

/** A final-commit policy check must finish synchronously while the writer lock is held. */
export function assertWorkflowSynchronousAuthority(assertion?: () => void): void {
  const result: unknown = assertion?.();
  if (result === undefined) return;
  try { Promise.prototype.then.call(result, undefined, () => {}); } catch {}
  throw new WorkflowError('Workflow authority assertion must be synchronous', 'WORKFLOW_CONFIG_INVALID', 500);
}
