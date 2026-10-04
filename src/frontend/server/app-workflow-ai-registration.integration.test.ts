import type { LanguageModelV4GenerateResult, ProviderV4 } from '@ai-sdk/provider';
import { afterEach, describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';

import {
  AIAgentRegistry,
  AIDurableAgentService,
  AIDurableAgentWorkflowRuntime,
  AIService,
  defineAIAgent,
} from '../../ai';
import { applicationServiceDataScope } from '../../auth/service-data-scope';
import type { WorkflowService } from '../../workflows';
import { createApp } from './app-factory';

type ManagedApp = Awaited<ReturnType<typeof createApp>>;

let activeApp: ManagedApp | null = null;

afterEach(async () => {
  await activeApp?.stop(true);
  activeApp = null;
});

describe('managed Torrent AI registration', () => {
  test('uses the app-local AI service to resolve durable agent aliases', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: generated('managed alias resolved'),
    });
    const adapter: ProviderV4 = {
      specificationVersion: 'v4',
      languageModel: () => model,
      embeddingModel: () => { throw new Error('not used'); },
      imageModel: () => { throw new Error('not used'); },
    };
    const definition = defineAIAgent({
      name: 'managed-alias-agent',
      version: '1',
      model: 'smart',
      tools: {},
      limits: { maxSteps: 1 },
    });
    let observedAI: AIService | null | undefined;
    let runtime: AIDurableAgentWorkflowRuntime | undefined;
    let workflows: WorkflowService | undefined;

    activeApp = await createApp({
      db: { mode: 'memory' },
      tables: {},
      auth: true,
      ai: {
        autoDetect: false,
        providers: {
          test: {
            type: 'custom',
            adapter,
            capabilities: { text: true },
          },
        },
        aliases: { smart: 'test/managed-model' },
      },
      workflows: {
        async register(registry, context) {
          observedAI = context.ai;
          if (!context.ai) throw new Error('Managed AI service was not available.');
          runtime = await context.ai.createDurableAgentRuntime(registry, {
            agents: new AIAgentRegistry(),
          });
          runtime.register(definition);
        },
        onServiceCreated(service) {
          workflows = service;
        },
      },
      email: false,
      migrate: false,
      serverResourcesDir: false,
      serverPluginsDir: false,
      serverMiddlewareDir: false,
      serverEndpointsDir: false,
      serverRoutesDir: false,
      resourceRoutes: false,
      observability: false,
    });

    expect(observedAI).toBeInstanceOf(AIService);
    expect(runtime).toBeInstanceOf(AIDurableAgentWorkflowRuntime);
    expect(workflows).toBeDefined();
    const agents = new AIDurableAgentService(runtime!, { workflows: workflows! });
    const runId = await agents.startAsSystem(
      { name: definition.name, version: definition.version },
      { prompt: 'Use the managed alias.', runtimeContext: {}, toolsContext: {} },
      { principal: 'managed-registration-test', reason: 'Verify app-local AI resolution' },
    );

    expect(agents.getResult(runId, applicationServiceDataScope())).toMatchObject({
      status: 'completed',
      text: 'managed alias resolved',
      turns: 1,
    });
  }, 30_000);
});

function generated(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
}
