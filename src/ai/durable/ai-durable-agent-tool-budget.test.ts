import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';

import { defineAIAgent } from '../agents/ai-agent-definition';
import {
  AI_DURABLE_MIN_TOOL_RESULT_BYTES,
  allocateAIDurableToolResultBudgets,
} from './ai-durable-agent-tool-budget';

describe('durable AI tool-result budgets', () => {
  test('allocates deterministic bounded shares without oversubscribing total capacity', () => {
    const definition = agent(100, 250);
    const first = allocateAIDurableToolResultBudgets(definition, 3, 10);
    const second = allocateAIDurableToolResultBudgets(definition, 3, 10);
    expect(first).toEqual([80, 80, 80]);
    expect(second).toEqual(first);
    expect(first.reduce((sum, value) => sum + value, 0)).toBe(240);
    expect(first.every((value) => value <= 100)).toBe(true);
  });

  test('rejects an exhausted aggregate before any tool can execute', () => {
    const minimum = AI_DURABLE_MIN_TOOL_RESULT_BYTES;
    const definition = agent(minimum * 2, minimum * 2);
    expect(() => allocateAIDurableToolResultBudgets(
      definition,
      2,
      1,
    )).toThrow('insufficient cumulative tool-result capacity');
  });
});

function agent(maxToolResultBytes: number, maxTotalToolResultBytes: number) {
  return defineAIAgent({
    name: 'tool-budget',
    version: '1',
    model: new MockLanguageModelV4({}),
    tools: {},
    limits: { maxToolResultBytes, maxTotalToolResultBytes },
  });
}
