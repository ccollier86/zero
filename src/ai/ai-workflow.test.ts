import { describe, expect, test } from 'bun:test';

import { createAIWorkflowHandler } from './ai-workflow';
import type { AIGenerateConversationRequest, AITextResult } from './ai-types';
import type { StepContext } from '../workflows/types';

describe('createAIWorkflowHandler', () => {
  test('creates a workflow handler that calls the selected model with derived messages', async () => {
    let request: AIGenerateConversationRequest | null = null;
    const handler = createAIWorkflowHandler<{ customerId: string }>({
      service: {
        async generateConversation(input) {
          request = input;
          return { text: 'summary' } as AITextResult;
        },
      },
      model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
      system: 'Summarize customer records.',
      prompt: (ctx) => `Summarize ${ctx.input.customerId}`,
      metadata: { source: 'workflow-test' },
    });

    const output = await handler({
      input: { customerId: 'cust_123' },
      workflowInput: { requestedBy: 'admin' },
      instanceId: 'wf_1',
      stepIndex: 2,
      attempt: 0,
      execution: TEST_EXECUTION,
      zero: null,
      assertCurrentAuthority() {},
    } satisfies StepContext<{ customerId: string }>);

    expect(output).toBe('summary');
    expect(request).toMatchObject({
      model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
      system: 'Summarize customer records.',
      messages: [{ role: 'user', content: 'Summarize cust_123' }],
      metadata: {
        source: 'workflow-test',
        workflowInstanceId: 'wf_1',
        workflowStepIndex: 2,
      },
    });
  });

  test('can return the full AI result for workflow steps that need metadata', async () => {
    const handler = createAIWorkflowHandler({
      service: {
        async generateConversation() {
          return { text: 'full result', usage: { totalTokens: 10 } } as unknown as AITextResult;
        },
      },
      model: 'smart',
      output: 'result',
    });

    const output = await handler({
      input: 'Summarize this.',
      workflowInput: {},
      instanceId: 'wf_2',
      stepIndex: 0,
      attempt: 0,
      execution: TEST_EXECUTION,
      zero: null,
      assertCurrentAuthority() {},
    });

    expect(output).toMatchObject({
      text: 'full result',
      usage: { totalTokens: 10 },
    });
  });
});

const TEST_EXECUTION = Object.freeze({
  kind: 'system' as const,
  principal: 'test',
  reason: 'AI workflow unit test',
  scopeKind: 'application' as const,
  scopeId: 'application',
  tenantId: null,
  roles: [] as const,
  permissions: [] as const,
  allPermissions: true as const,
  legacyCompatibility: false,
});
