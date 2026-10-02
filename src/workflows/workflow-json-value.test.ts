import { describe, expect, test } from 'bun:test';

import {
  normalizeWorkflowJson,
  parseWorkflowJson,
  parseWorkflowRequestJson,
} from './workflow-json-value';

describe('workflow JSON trust boundaries', () => {
  test('treats malformed persisted JSON as corrupt server state', () => {
    expect(() => parseWorkflowJson('{not-json')).toThrow(expect.objectContaining({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    }));
  });

  test('keeps default durable-value normalization on the server-state boundary', () => {
    expect(() => normalizeWorkflowJson(Number.NaN)).toThrow(expect.objectContaining({
      code: 'WORKFLOW_STATE_INVALID',
      status: 500,
    }));
  });

  test('treats malformed caller-controlled JSON as a client error', () => {
    expect(() => parseWorkflowRequestJson('{not-json')).toThrow(expect.objectContaining({
      code: 'WORKFLOW_REQUEST_PARSE_FAILED',
      status: 400,
    }));
  });

  test('keeps invalid handler values on their declared client boundary', () => {
    expect(() => normalizeWorkflowJson(Number.NaN, 'WORKFLOW_INPUT_INVALID'))
      .toThrow(expect.objectContaining({
        code: 'WORKFLOW_INPUT_INVALID',
        status: 400,
      }));
  });

  test('preserves the caller boundary for structurally unsafe parsed JSON', () => {
    expect(() => parseWorkflowRequestJson('{"__proto__":{"polluted":true}}'))
      .toThrow(expect.objectContaining({
        code: 'WORKFLOW_REQUEST_PARSE_FAILED',
        status: 400,
      }));
    expect(() => parseWorkflowJson('{"__proto__":{"polluted":true}}'))
      .toThrow(expect.objectContaining({
        code: 'WORKFLOW_STATE_INVALID',
        status: 500,
      }));
  });
});
