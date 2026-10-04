import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

import { AIError } from '../ai-errors';
import { defineAIAgent } from './ai-agent-definition';
import { AIAgentRegistry } from './ai-agent-registry';
import { defineAIAgentTool } from './ai-agent-tool';

const model = new MockLanguageModelV4();

describe('AI agent definitions and registry', () => {
  test('normalizes bounded policy and stores exact immutable versions', () => {
    const ping = defineAIAgentTool({
      inputSchema: z.object({ value: z.string() }),
      execute: ({ value }) => ({ value }),
    });
    const definition = defineAIAgent({
      name: 'support.agent',
      version: '1.0.0',
      model,
      tools: { ping },
      limits: { maxSteps: 4, maxToolCalls: 6, maxToolCallsPerStep: 2 },
      timeout: {
        totalMs: 5_000,
        stepMs: 1_000,
        firstChunkMs: 800,
        chunkMs: 400,
        toolMs: 300,
        tools: { pingMs: 250 },
      },
    });

    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.tools)).toBe(true);
    expect(Object.isFrozen(definition.limits)).toBe(true);
    expect(Object.isFrozen(definition.timeout)).toBe(true);
    expect(definition.timeout).toEqual({
      totalMs: 5_000,
      stepMs: 1_000,
      firstChunkMs: 800,
      chunkMs: 400,
      toolMs: 300,
      tools: { pingMs: 250 },
    });
    expect(definition.limits.maxSteps).toBe(4);

    const registry = new AIAgentRegistry();
    expect(registry.register(definition)).toBe(definition);
    expect(registry.require({ name: 'support.agent', version: '1.0.0' })).toBe(definition);
    expect(() => registry.register(definition)).toThrow(AIError);
    expect(() => registry.require({ name: 'support.agent', version: '2.0.0' })).toThrow(
      expect.objectContaining({ code: 'AI_AGENT_NOT_REGISTERED' }),
    );
  });

  test('rejects invalid identities, unsafe budgets, and unknown timeout tools', () => {
    const tool = defineAIAgentTool({
      inputSchema: z.object({}),
      execute: () => ({ ok: true }),
    });

    expect(() => defineAIAgent({
      name: 'Invalid Name',
      version: '1',
      model,
      tools: { tool },
    })).toThrow(expect.objectContaining({ code: 'AI_AGENT_DEFINITION_INVALID' }));

    expect(() => defineAIAgent({
      name: 'valid',
      version: '1',
      model,
      tools: { tool },
      limits: { maxSteps: 1_000 },
    })).toThrow(expect.objectContaining({ code: 'AI_AGENT_DEFINITION_INVALID' }));

    expect(() => defineAIAgent({
      name: 'valid',
      version: '1',
      model,
      tools: { tool },
      timeout: { tools: { missingMs: 10 } } as any,
    })).toThrow(expect.objectContaining({ code: 'AI_AGENT_DEFINITION_INVALID' }));

    expect(() => defineAIAgent({
      name: 'valid',
      version: '1',
      model,
      tools: { tool },
      approval: { missing: 'user-approval' } as any,
    })).toThrow(expect.objectContaining({ code: 'AI_AGENT_DEFINITION_INVALID' }));
  });

  test('pins mutable JSON policy under the declared version', () => {
    const tool = defineAIAgentTool({
      inputSchema: z.object({}),
      execute: () => ({ ok: true }),
    });
    const instructions = [{
      role: 'system' as const,
      content: 'original',
      providerOptions: { test: { mode: 'safe' } },
    }];
    const providerOptions = { test: { region: 'one' } };
    const definition = defineAIAgent({
      name: 'pinned',
      version: '1',
      model,
      tools: { tool },
      instructions,
      providerOptions,
    });

    instructions[0]!.content = 'mutated';
    instructions[0]!.providerOptions.test.mode = 'changed';
    providerOptions.test.region = 'two';

    expect(definition.instructions).toEqual([{
      role: 'system',
      content: 'original',
      providerOptions: { test: { mode: 'safe' } },
    }]);
    expect(definition.providerOptions).toEqual({ test: { region: 'one' } });
    expect(Object.isFrozen(definition.instructions)).toBe(true);
    expect(Object.isFrozen(definition.providerOptions)).toBe(true);
  });
});
