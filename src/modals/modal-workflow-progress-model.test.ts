/** Honest workflow progress and capability gating from synthetic authorized observations. */
import { describe, expect, test } from 'bun:test';
import { deriveModalWorkflowProgress } from './modal-workflow-progress-model';
import type { WorkflowProgress, WorkflowProgressCounts } from '../frontend/client/workflow-run-hooks';
import type { WorkflowClientInstanceRecord } from '../workflows/types';
const counts = (totalSteps: number, completedSteps: number): WorkflowProgressCounts => ({ totalSteps, completedSteps,
  failedSteps: 0, runningSteps: 0, percent: totalSteps ? Math.round(completedSteps / totalSteps * 100) : 0 });
const progress = (total: number, complete: number): WorkflowProgress => {
  const rootNodes = counts(total, complete); return { ...rootNodes, rootNodes, fanoutItems: counts(20, 10), deliverySteps: counts(2, 1) };
};
const instance = (status: WorkflowClientInstanceRecord['status']) => ({ instance_id: 'run', status }) as WorkflowClientInstanceRecord;
describe('workflow progress presentation', () => {
  test('zero-root workflow is indeterminate even if dynamic activity has many completions', () => {
    const model = deriveModalWorkflowProgress({ status: 'ready', instance: instance('running') }, progress(0, 0), {});
    expect(model.determinate).toBe(false); expect(model.percent).toBeNull(); expect(model.terminal).toBe(false);
    expect(model.progress.fanoutItems.totalSteps).toBe(20);
  });
  test('failed and cancelled durable outcomes win over 100 percent root completion', () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const model = deriveModalWorkflowProgress({ status: 'ready', instance: instance(status) }, progress(10, 10),
        { waitingForInput: true, retrying: true }, { cancel: true, pause: true, resume: true });
      expect(model.label).toBe(status === 'failed' ? 'Failed' : 'Cancelled');
      expect(model.terminal).toBe(true); expect(model.canCancel || model.canPause || model.canResume).toBe(false);
    }
  });
  test('a rounded 100 percent never marks a running instance completed', () => {
    const model = deriveModalWorkflowProgress({ status: 'ready', instance: instance('running') }, progress(500, 499), {});
    expect(model.percent).toBe(100); expect(model.label).toBe('Running'); expect(model.terminal).toBe(false);
  });
  test('root denominator stays independent from fanout and delivery', () => {
    const model = deriveModalWorkflowProgress({ status: 'ready', instance: instance('running') }, progress(2, 1), {});
    expect(model.percent).toBe(50); expect(model.progress.rootNodes.totalSteps).toBe(2);
    expect(model.progress.fanoutItems.percent).toBe(50); expect(model.progress.deliverySteps.totalSteps).toBe(2);
  });
  test('controls require explicit capability, correct run state and ready observation', () => {
    const options = { cancel: true, pause: true, resume: true };
    const running = deriveModalWorkflowProgress({ status: 'ready', instance: instance('running') }, progress(2, 0), {}, options);
    expect(running.canPause).toBe(true); expect(running.canResume).toBe(false); expect(running.canCancel).toBe(true);
    const paused = deriveModalWorkflowProgress({ status: 'ready', instance: instance('paused') }, progress(2, 1), {}, options);
    expect(paused.canPause).toBe(false); expect(paused.canResume).toBe(true);
    const reconnect = deriveModalWorkflowProgress({ status: 'reconnecting', instance: instance('running') }, progress(2, 1), {}, options);
    expect(reconnect.canCancel || reconnect.canPause || reconnect.canResume).toBe(false); expect(reconnect.percent).toBeNull();
    const unavailable = deriveModalWorkflowProgress({ status: 'unavailable', instance: null }, progress(2, 1), {}, options);
    expect(unavailable.label).toBe('Workflow unavailable'); expect(unavailable.canCancel).toBe(false);
  });
  test('waiting and retry state are derived activity, not fabricated persisted statuses', () => {
    const waiting = deriveModalWorkflowProgress({ status: 'ready', instance: instance('running') }, progress(2, 1), { waitingForInput: true });
    expect(waiting.label).toBe('Waiting for input'); expect(waiting.status).toBe('running');
    const retry = deriveModalWorkflowProgress({ status: 'ready', instance: instance('running') }, progress(2, 1), { retrying: true });
    expect(retry.label).toBe('Retrying'); expect(retry.status).toBe('running');
  });
});
