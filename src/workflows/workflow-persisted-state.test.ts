import { describe, expect, test } from 'bun:test';

import { validateWorkflowPersistedState } from './workflow-persisted-state';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';

const NOW = '2030-01-02T03:04:05.000Z';

describe('workflow persisted-state validation', () => {
  test('accepts current display labels and Zero 1.3 handler-key step names', () => {
    const current = state();
    expect(() => validateWorkflowPersistedState(current.instance, current.steps))
      .not.toThrow();

    const legacy = state();
    legacy.steps[0]!.step_name = 'handler-key';
    expect(() => validateWorkflowPersistedState(legacy.instance, legacy.steps))
      .not.toThrow();
  });

  test('accepts the legacy paused-instance/running-step shape for resume normalization', () => {
    const legacy = state();
    legacy.instance.status = 'paused';
    legacy.steps[0]!.status = 'running';
    legacy.steps[0]!.started_at = NOW;
    expect(() => validateWorkflowPersistedState(legacy.instance, legacy.steps))
      .not.toThrow();
  });

  test('accepts a completed prefix followed by one pristine frontier and suffix', () => {
    const fixture = twoStepState();
    fixture.steps[0]!.status = 'completed';
    fixture.steps[0]!.started_at = NOW;
    fixture.steps[0]!.completed_at = NOW;
    fixture.instance.current_step = 0;
    const validated = validateWorkflowPersistedState(fixture.instance, fixture.steps);
    expect(validated.frontier?.step_index).toBe(1);
  });

  test('rejects every progressed successor shape behind an unfinished frontier', () => {
    const mutations: Array<(step: WorkflowStepRecord) => void> = [
      (step) => {
        step.status = 'running';
        step.started_at = NOW;
      },
      (step) => {
        step.status = 'completed';
        step.started_at = NOW;
        step.completed_at = NOW;
      },
      (step) => {
        step.status = 'failed';
        step.error = 'failed';
        step.completed_at = NOW;
      },
      (step) => {
        step.status = 'skipped';
        step.completed_at = NOW;
      },
      (step) => { step.started_at = NOW; },
      (step) => { step.retries = 1; },
    ];
    for (const mutate of mutations) {
      const fixture = twoStepState();
      mutate(fixture.steps[1]!);
      expect(() => validateWorkflowPersistedState(fixture.instance, fixture.steps))
        .toThrow(/progressed behind an unfinished frontier/);
    }
  });

  test('binds retry budgets to the immutable definition snapshot', () => {
    const fixture = state();
    fixture.steps[0]!.max_retries = 4;
    expect(() => validateWorkflowPersistedState(fixture.instance, fixture.steps))
      .toThrow(/retry budget does not match/);
  });

  test('rejects impossible status/timestamp combinations', () => {
    const running = state();
    running.steps[0]!.status = 'running';
    expect(() => validateWorkflowPersistedState(running.instance, running.steps))
      .toThrow(/impossible running lifecycle/);

    const completed = state();
    completed.steps[0]!.status = 'completed';
    completed.steps[0]!.started_at = NOW;
    expect(() => validateWorkflowPersistedState(completed.instance, completed.steps))
      .toThrow(/no terminal completion timestamp/);
  });

  const corruptions: Array<{
    name: string;
    mutate: (instance: WorkflowInstanceRecord, steps: WorkflowStepRecord[]) => void;
    message: RegExp;
  }> = [
    {
      name: 'missing definition snapshot',
      mutate: (instance) => { instance.steps_json = null; },
      message: /snapshot is missing/,
    },
    {
      name: 'malformed definition JSON',
      mutate: (instance) => { instance.steps_json = '{bad json'; },
      message: /malformed JSON/,
    },
    {
      name: 'empty definition snapshot',
      mutate: (instance) => { instance.steps_json = '[]'; },
      message: /at least one step/,
    },
    {
      name: 'malformed definition handler key',
      mutate: (instance) => {
        instance.steps_json = JSON.stringify([{ name: 'Step', handler: ' handler-key ' }]);
      },
      message: /invalid handler key/,
    },
    {
      name: 'definition display name with surrounding whitespace',
      mutate: (instance) => {
        instance.steps_json = JSON.stringify([{ name: ' Step ', handler: 'handler-key' }]);
      },
      message: /has no display name/,
    },
    {
      name: 'unknown definition topology field',
      mutate: (instance) => {
        instance.steps_json = JSON.stringify([{
          name: 'Step',
          handler: 'handler-key',
          parallel: true,
        }]);
      },
      message: /property "parallel" is not supported/,
    },
    {
      name: 'unknown instance status',
      mutate: (instance) => { instance.status = 'mystery' as never; },
      message: /Unknown workflow instance status/,
    },
    {
      name: 'unsupported pending instance status',
      mutate: (instance) => { instance.status = 'pending'; },
      message: /Unknown workflow instance status/,
    },
    {
      name: 'unknown step status',
      mutate: (_instance, steps) => { steps[0]!.status = 'mystery' as never; },
      message: /Unknown workflow step status/,
    },
    {
      name: 'missing step index',
      mutate: (_instance, steps) => { steps[0]!.step_index = 1; },
      message: /indices are missing or duplicated|rows do not match/,
    },
    {
      name: 'invalid retry timestamp',
      mutate: (_instance, steps) => {
        steps[0]!.status = 'failed';
        steps[0]!.retries = 1;
        steps[0]!.retry_at = 'tomorrow';
      },
      message: /retry_at is invalid/,
    },
    {
      name: 'invalid timeout timestamp',
      mutate: (_instance, steps) => { steps[0]!.timeout_at = '2030-01-02'; },
      message: /timeout_at is invalid/,
    },
    {
      name: 'impossible retry counters',
      mutate: (_instance, steps) => {
        steps[0]!.retries = 4;
        steps[0]!.max_retries = 3;
      },
      message: /impossible retry counters/,
    },
  ];

  for (const corruption of corruptions) {
    test(`rejects ${corruption.name}`, () => {
      const fixture = state();
      corruption.mutate(fixture.instance, fixture.steps);
      expect(() => validateWorkflowPersistedState(fixture.instance, fixture.steps))
        .toThrow(corruption.message);
    });
  }
});

function state(): {
  instance: WorkflowInstanceRecord;
  steps: WorkflowStepRecord[];
} {
  return {
    instance: {
      instance_id: 'instance',
      definition_id: 'definition',
      name: 'test',
      status: 'running',
      current_step: 0,
      input: '{"ok":true}',
      output: null,
      error: null,
      started_by: 'user',
      steps_json: JSON.stringify([{ name: 'Display label', handler: 'handler-key' }]),
      created_at: NOW,
      updated_at: NOW,
      completed_at: null,
    },
    steps: [{
      step_id: 'step',
      instance_id: 'instance',
      step_index: 0,
      step_name: 'Display label',
      status: 'pending',
      input: null,
      output: null,
      error: null,
      retries: 0,
      max_retries: 3,
      retry_at: null,
      wait_event: null,
      timeout_at: null,
      started_at: null,
      completed_at: null,
      created_at: NOW,
    }],
  };
}

function twoStepState(): {
  instance: WorkflowInstanceRecord;
  steps: WorkflowStepRecord[];
} {
  const fixture = state();
  fixture.instance.steps_json = JSON.stringify([
    { name: 'Display label', handler: 'handler-key' },
    { name: 'Second', handler: 'second-handler' },
  ]);
  fixture.steps.push({
    ...fixture.steps[0]!,
    step_id: 'step-2',
    step_index: 1,
    step_name: 'Second',
  });
  return fixture;
}
