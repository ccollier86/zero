import { describe, expect, test } from 'bun:test';

import type { WorkflowJsonValue } from '../../workflows/workflow-json-value';
import type { AnyAIAgentDefinition } from '../agents/ai-agent-definition';
import {
  assertAIDurableDefinitionCapacity,
  assertAIDurableSeedCapacity,
} from './ai-durable-agent-capacity';
import {
  AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES,
  AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES,
  AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES,
} from './ai-durable-agent-limits';

describe('durable AI agent capacity contract', () => {
  test('admits the exact context/tool envelope and rejects one byte beyond it', () => {
    expect(() => assertAIDurableDefinitionCapacity(definitionWithEnvelope(
      AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES - 1,
      1,
    ))).not.toThrow();
    expect(() => assertAIDurableDefinitionCapacity(definitionWithEnvelope(
      AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES,
      1,
    ))).toThrow(expect.objectContaining({
      code: 'AI_AGENT_DEFINITION_INVALID',
      status: 400,
    }));
  });

  test('checks exact stored bytes and entry count before workflow creation', () => {
    const exact = {
      state: 'x'.repeat(AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES - 2),
    } satisfies Record<string, WorkflowJsonValue>;
    expect(() => assertAIDurableSeedCapacity(exact)).not.toThrow();
    expect(() => assertAIDurableSeedCapacity({
      state: `${exact.state}x`,
    })).toThrow(expect.objectContaining({
      code: 'AI_AGENT_CONTEXT_INVALID',
      status: 413,
    }));

    const tooMany = Object.fromEntries(Array.from(
      { length: AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES + 1 },
      (_, index) => [`key-${index}`, null],
    ));
    expect(() => assertAIDurableSeedCapacity(tooMany)).toThrow(expect.objectContaining({
      code: 'AI_AGENT_CONTEXT_INVALID',
      status: 413,
    }));
  });
});

function definitionWithEnvelope(
  maxContextBytes: number,
  maxTotalToolResultBytes: number,
): AnyAIAgentDefinition {
  return {
    limits: {
      maxContextBytes,
      maxTotalToolResultBytes,
    },
  } as AnyAIAgentDefinition;
}

