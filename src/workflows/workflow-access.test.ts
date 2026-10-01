import { describe, expect, test } from 'bun:test';
import { canAccessWorkflowDefinition } from './workflow-access';
import { WorkflowRegistry } from './workflow-registry';
import {
  MAX_WORKFLOW_ATTEMPTS,
  WORKFLOW_SERVER_TABLE_NAMES,
  WORKFLOW_TABLES,
  type WorkflowDefinition,
} from './types';

describe('workflow definition access', () => {
  test('keeps server topology out of the browser table descriptor', () => {
    expect(WORKFLOW_TABLES.workflow_definitions).toBeUndefined();
    expect(WORKFLOW_TABLES.workflow_instances).not.toHaveProperty('steps_json');
    expect(WORKFLOW_TABLES.workflow_steps).not.toHaveProperty('wait_event');
    expect(WORKFLOW_SERVER_TABLE_NAMES.has('workflow_definitions')).toBe(true);
    expect(WORKFLOW_SERVER_TABLE_NAMES.has('workflow_instances')).toBe(true);
  });

  test('preserves authenticated defaults and lets global admins bypass role rules', () => {
    const open = definition();
    const restricted = definition({ start: ['operator'] });

    expect(canAccessWorkflowDefinition(open, 'start', { role: 'user' })).toBe(true);
    expect(canAccessWorkflowDefinition(open, 'inspect', { role: 'user' })).toBe(true);
    expect(canAccessWorkflowDefinition(open, 'start', null)).toBe(false);
    expect(canAccessWorkflowDefinition(restricted, 'start', { role: 'user' })).toBe(false);
    expect(canAccessWorkflowDefinition(restricted, 'inspect', { role: 'user' })).toBe(false);
    expect(canAccessWorkflowDefinition(restricted, 'start', { role: 'operator' })).toBe(true);
    expect(canAccessWorkflowDefinition(restricted, 'inspect', { role: 'admin' })).toBe(true);
  });

  test('allows inspect to widen discovery without widening start authority', () => {
    const workflow = definition({ start: 'admin', inspect: 'authenticated' });

    expect(canAccessWorkflowDefinition(workflow, 'inspect', { role: 'user' })).toBe(true);
    expect(canAccessWorkflowDefinition(workflow, 'start', { role: 'user' })).toBe(false);
  });

  test('canonicalizes, deduplicates, defensively copies, and freezes role rules', () => {
    const roles = [' operator ', 'operator', 'reviewer'];
    const registry = registryWithNoop();
    registry.create({
      name: 'restricted',
      access: { start: roles },
      steps: [{ name: 'Noop', handler: 'noop' }],
    });
    roles.push('user');

    const stored = registry.get('restricted')!;
    expect(stored.access?.start).toEqual(['operator', 'reviewer']);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.access)).toBe(true);
    expect(Object.isFrozen(stored.access?.start)).toBe(true);
    expect(canAccessWorkflowDefinition(stored, 'start', { role: 'user' })).toBe(false);
  });

  test('rejects malformed policies, empty workflows, and unsafe attempt budgets', () => {
    const handlerRegistry = new WorkflowRegistry();
    expect(() => handlerRegistry.registerHandler(' noop ', async () => null))
      .toThrow(/surrounding whitespace/);

    const cases: WorkflowDefinition[] = [
      definition({ start: [] }),
      definition({ start: [' '] }),
      definition({ start: 'manager' as 'admin' }),
      definition({ starts: 'admin' } as WorkflowDefinition['access']),
      {
        ...definition(),
        retry: 3,
      } as WorkflowDefinition,
      {
        name: 'unknown-step-property',
        steps: [{
          name: 'Noop',
          handler: 'noop',
          wait_for: 'continue',
        } as WorkflowDefinition['steps'][number]],
      },
      {
        name: 'empty-workflow',
        steps: [],
      },
      {
        name: ' spaced-workflow ',
        steps: [{ name: 'Noop', handler: 'noop' }],
      },
      {
        name: 'spaced-wait-event',
        steps: [{ name: 'Noop', handler: 'noop', waitFor: ' continue ' }],
      },
      {
        name: 'excessive-retries',
        steps: [{
          name: 'Noop',
          handler: 'noop',
          retries: MAX_WORKFLOW_ATTEMPTS + 1,
        }],
      },
    ];

    for (const candidate of cases) {
      const registry = registryWithNoop();
      expect(() => registry.create(candidate)).toThrow();
      try {
        registry.create(candidate);
      } catch (error) {
        expect(error).toMatchObject({
          code: 'WORKFLOW_DEFINITION_INVALID',
          status: 500,
        });
      }
    }
  });
});

function registryWithNoop(): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registry.registerHandler('noop', async () => null);
  return registry;
}

function definition(
  access?: WorkflowDefinition['access'],
): WorkflowDefinition {
  return {
    name: 'test-workflow',
    access,
    steps: [{ name: 'Noop', handler: 'noop' }],
  };
}
