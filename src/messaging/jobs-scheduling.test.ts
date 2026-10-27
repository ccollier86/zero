/** Deterministic scheduler-only test. Fake transport receipts are not provider, Guardian or native persistence qualification. */
import { expect, test } from 'bun:test';
import type { ReactiveDB } from '../sync/reactive-db';
import type { WorkflowService } from '../workflows/workflow-service';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import type { MessagingRuntime } from './runtime';
import type { ResolvedMessagingConfig } from './config';
import { MessagingJobs } from './jobs';

test('a completion plus newly inserted head work cannot reset the active page and starve older jobs', async () => {
  const scope = applicationServiceDataScope(), pending = new Set(['job10', 'job11']), admitted: string[] = [], cursors: string[] = [];
  let changed: ((change: { table: string; rowId: string; row: { status: string } }) => void) | undefined;
  const runtime = {
    retainedScopes: () => [scope],
    async read(_scope: unknown, name: string, input: { after?: string; limit: number }) {
      if (name !== 'messaging.jobs.pending') throw new Error('Unexpected scheduler read.');
      cursors.push(input.after ?? '');
      return [...pending].sort().filter(id => id > (input.after ?? '')).slice(0, input.limit).map(id => ({ id, workflow_id: null, dispatch_generation: 0 }));
    },
    async write(_scope: unknown, name: string) { if (name !== 'messaging.job.dispatch') throw new Error('Unexpected scheduler write.'); return { bound: true }; },
  };
  const jobs = new MessagingJobs({
    runtime: runtime as unknown as MessagingRuntime,
    system: { onChange(listener: typeof changed) { changed = listener; return () => { changed = undefined; }; } } as unknown as ReactiveDB,
    config: { jobConcurrency: 1, assistant: false } as ResolvedMessagingConfig,
    directory: { assertScope() {}, assertRecipient() {}, notificationRecipient() { return false; }, list() { return { items: [], hasMore: false, nextCursor: null }; } }, ai: null, logging: null, notifications: null,
    dispatchFailed() { throw new Error('Unexpected scheduler dispatch failure.'); },
  });
  const workflow = { async enqueueAsSystemOnce(_name: string, input: { jobId: string }) { admitted.push(input.jobId); return { instanceId: 'workflow-' + input.jobId }; } } as unknown as WorkflowService;
  const until = async (length: number) => { const deadline = Date.now() + 2000; while (admitted.length < length) { if (Date.now() >= deadline) throw new Error('Scheduler did not advance.'); await Bun.sleep(1); } };
  try {
    jobs.start(workflow); await until(1); expect(admitted).toEqual(['job10']);
    pending.delete('job10'); pending.add('job00');
    changed!({ table: 'workflow_instances', rowId: 'workflow-job10', row: { status: 'completed' } });
    await until(2); expect(admitted).toEqual(['job10', 'job11']); expect(cursors).toContain('job10');
    pending.delete('job11'); changed!({ table: 'workflow_instances', rowId: 'workflow-job11', row: { status: 'completed' } });
    await until(3); expect(admitted).toEqual(['job10', 'job11', 'job00']);
  } finally { await jobs.close(); }
});
