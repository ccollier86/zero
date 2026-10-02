import { describe, expect, test } from 'bun:test';

import { createAIWorkflowHandler } from './ai-workflow';
import type { AIGenerateConversationRequest, AITextResult } from './ai-types';
import type { StepContext } from '../workflows/types';

describe('createAIWorkflowHandler', () => {
  test('creates a workflow handler that calls the selected model with derived messages', async () => {
    let request: AIGenerateConversationRequest | null = null;
    let authorityChecks = 0;
    const workflowAbort = new AbortController();
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
      signal: workflowAbort.signal,
      execution: TEST_EXECUTION,
      zero: null,
      assertCurrentAuthority() {
        authorityChecks += 1;
      },
    } satisfies StepContext<{ customerId: string }>);

    expect(output).toBe('summary');
    expect(authorityChecks).toBe(1);
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
    expect(request!.abortSignal).toBe(workflowAbort.signal);
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

  test('combines configured cancellation with workflow cancellation', async () => {
    const workflowAbort = new AbortController();
    const configuredAbort = new AbortController();
    let requestSignal: AbortSignal | undefined;
    let markRequestStarted: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const handler = createAIWorkflowHandler({
      service: {
        async generateConversation(request) {
          requestSignal = request.abortSignal;
          markRequestStarted?.();
          return await new Promise<AITextResult>((_resolve, reject) => {
            request.abortSignal?.addEventListener(
              'abort',
              () => reject(request.abortSignal?.reason),
              { once: true },
            );
          });
        },
      },
      model: 'smart',
      abortSignal: configuredAbort.signal,
    });

    const pending = handler({
      input: 'Summarize this.',
      workflowInput: {},
      instanceId: 'wf_cancel',
      stepIndex: 0,
      attempt: 0,
      signal: workflowAbort.signal,
      execution: TEST_EXECUTION,
      zero: null,
      assertCurrentAuthority() {},
    });

    await requestStarted;
    expect(requestSignal).toBeDefined();
    expect(requestSignal).not.toBe(workflowAbort.signal);
    expect(requestSignal).not.toBe(configuredAbort.signal);

    const reason = new Error('workflow cancelled');
    workflowAbort.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(requestSignal?.aborted).toBe(true);
  });

  test('does not begin the provider request when authority revalidation fails', async () => {
    let providerCalls = 0;
    const revoked = new Error('workflow authority revoked');
    const handler = createAIWorkflowHandler({
      service: {
        async generateConversation() {
          providerCalls += 1;
          return { text: 'should not run' } as AITextResult;
        },
      },
      model: 'smart',
    });

    const pending = handler({
      input: 'Summarize this.',
      workflowInput: {},
      instanceId: 'wf_revoked',
      stepIndex: 0,
      attempt: 0,
      execution: TEST_EXECUTION,
      zero: null,
      assertCurrentAuthority() {
        throw revoked;
      },
    });

    await expect(pending).rejects.toBe(revoked);
    expect(providerCalls).toBe(0);
  });

  test('does not begin the provider request when cancellation already won', async () => {
    let providerCalls = 0;
    const workflowAbort = new AbortController();
    const reason = new Error('workflow already cancelled');
    workflowAbort.abort(reason);
    const handler = createAIWorkflowHandler({
      service: {
        async generateConversation() {
          providerCalls += 1;
          return { text: 'should not run' } as AITextResult;
        },
      },
      model: 'smart',
    });

    const pending = handler({
      input: 'Summarize this.',
      workflowInput: {},
      instanceId: 'wf_cancelled',
      stepIndex: 0,
      attempt: 0,
      signal: workflowAbort.signal,
      execution: TEST_EXECUTION,
      zero: null,
      assertCurrentAuthority() {},
    });

    await expect(pending).rejects.toBe(reason);
    expect(providerCalls).toBe(0);
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
