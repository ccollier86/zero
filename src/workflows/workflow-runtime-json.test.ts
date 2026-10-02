import { describe, expect, test } from 'bun:test';

import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';

describe('workflow runtime JSON trust boundary', () => {
  test('rejects lossy caller input with its declared validation contract', () => {
    const namedArray = [1] as unknown[] & { extra?: number };
    namedArray.extra = 2;
    const hidden = { visible: true };
    Object.defineProperty(hidden, 'hidden', { value: true });
    const symbolMember = { visible: true } as Record<PropertyKey, unknown>;
    symbolMember[Symbol('private')] = true;
    for (const value of [
      { nested: undefined },
      { nested: Number.NaN },
      new Date('2026-01-01T00:00:00.000Z'),
      new Array(1),
      namedArray,
      hidden,
      symbolMember,
    ]) {
      expect(() => serializeWorkflowRuntimeJson(value, {
        code: 'WORKFLOW_INPUT_INVALID',
        label: 'Workflow input',
      })).toThrow(expect.objectContaining({
        code: 'WORKFLOW_INPUT_INVALID',
        status: 422,
        message: 'Workflow input is not JSON-serializable',
      }));
    }
  });

  test('reports framework-owned output failures as server errors', () => {
    expect(() => serializeWorkflowRuntimeJson({ nested: undefined }, {
      code: 'WORKFLOW_ACTIVITY_OUTPUT_INVALID',
      label: 'Workflow activity output',
      invalidStatus: 500,
      limitStatus: 500,
    })).toThrow(expect.objectContaining({
      code: 'WORKFLOW_ACTIVITY_OUTPUT_INVALID',
      status: 500,
      message: 'Workflow activity output is not JSON-serializable',
    }));
  });

  test('retains detached strict JSON data without lossy coercion', () => {
    expect(serializeWorkflowRuntimeJson({ ok: true, nested: [1, null, 'two'] }, {
      code: 'WORKFLOW_INPUT_INVALID',
      label: 'Workflow input',
    })).toBe('{"ok":true,"nested":[1,null,"two"]}');
    expect(serializeWorkflowRuntimeJson(undefined, {
      code: 'WORKFLOW_INPUT_INVALID',
      label: 'Workflow input',
    })).toBeNull();
  });
});
