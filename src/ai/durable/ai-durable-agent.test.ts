import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

import {
  applicationServiceDataScope,
  trustedSystemServiceDataScope,
  type ServiceDataScope,
} from '../../auth/service-data-scope';
import type { AuthContext, AuthContextAuthorityReference } from '../../auth/types';
import { createReactiveDB, type ReactiveDB } from '../../sync/reactive-db';
import {
  WorkflowExecutionAuthorityStore,
  type WorkflowActorExecutionAuthority,
  type WorkflowExecutionAuthorityProvider,
  type WorkflowResolvedExecutionAuthority,
} from '../../workflows/workflow-execution-authority';
import { WorkflowInteractionAuthority } from '../../workflows/workflow-interaction-authority';
import type { WorkflowClock } from '../../workflows/workflow-executor';
import { WorkflowRegistry } from '../../workflows/workflow-registry';
import { defineWorkflowTables } from '../../workflows/workflow-schema';
import { WorkflowService, type WorkflowServiceOptions } from '../../workflows/workflow-service';
import { getWorkflowGraphRuntime } from '../../workflows/workflow-service';
import {
  defineAIAgent,
  type AnyAIAgentDefinition,
} from '../agents/ai-agent-definition';
import { AIAgentRegistry } from '../agents/ai-agent-registry';
import type { AIAgentLifecycleEvent, AIAgentObserver } from '../agents/ai-agent-types';
import type { AIAgentPlatformCodeEmitter } from '../agents/ai-agent-types';
import {
  defineAIAgentTool,
  type AIAgentToolDefinition,
} from '../agents/ai-agent-tool';
import { AIDurableAgentService } from './ai-durable-agent-service';
import { AIDurableAgentWorkflowRuntime } from './ai-durable-agent-workflow';
import { readAIDurableMemory } from './ai-durable-agent-memory';
import {
  AI_DURABLE_MEMORY_KEYS,
  durableToolCallKey,
} from './ai-durable-agent-state';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const scope = applicationServiceDataScope();
const interactionAuthority = new WorkflowInteractionAuthority(() => true);

let db: ReactiveDB;
let workflows: WorkflowService[];

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  defineWorkflowTables(db);
  workflows = [];
});

afterEach(async () => {
  await Promise.allSettled(workflows.map((service) => service.dispose()));
  db.dispose();
});

describe('durable AI agents on Torrent', () => {
  test('persists model/tool boundaries privately and returns a scope-checked result', async () => {
    const executions: unknown[] = [];
    const lookup = defineAIAgentTool({
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      contextSchema: z.object({ privateToolContext: z.string() }),
      execute: (input, context) => {
        executions.push({ input, context });
        return { value: `private-output-${input.id}` };
      },
    });
    const definition = defineAIAgent({
      name: 'durable-records',
      version: '1',
      model: new MockLanguageModelV4({
        doGenerate: [
          generated([{
            type: 'tool-call', toolCallId: 'lookup-1', toolName: 'lookup',
            input: '{"id":"private-input-42"}',
          }], 'tool-calls'),
          generated([{ type: 'text', text: 'safe final answer' }], 'stop'),
        ],
      }),
      tools: { lookup },
      limits: { maxSteps: 2 },
    });
    const harness = createHarness(definition);
    const runId = await harness.agents.startAsSystem(
      harness.descriptor,
      {
        prompt: 'private prompt',
        runtimeContext: { privateRuntime: 'runtime-secret' },
        toolsContext: { lookup: { privateToolContext: 'tool-context-secret' } },
      },
      { principal: 'durable-test', reason: 'Exercise durable model/tool boundaries' },
    );

    expect(workflow(runId)?.status).toBe('completed');
    expect(harness.agents.getResult(runId, scope)).toMatchObject({
      runId,
      status: 'completed',
      text: 'safe final answer',
      turns: 2,
      toolCalls: 1,
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      input: { id: 'private-input-42' },
      context: {
        runId,
        toolCallId: 'lookup-1',
        runtimeContext: { privateRuntime: 'runtime-secret' },
      },
    });

    const publicRows = JSON.stringify({
      instances: db.prepare('SELECT input, output, error FROM workflow_instances').all(),
      steps: db.prepare('SELECT input, output, error FROM workflow_steps').all(),
      interactions: db.prepare('SELECT * FROM workflow_interactions').all(),
    });
    for (const secret of [
      'private prompt', 'runtime-secret', 'tool-context-secret',
      'private-input-42', 'private-output-',
    ]) expect(publicRows).not.toContain(secret);
    const privateRows = db.prepare(
      'SELECT key, value_json FROM _workflow_memory WHERE instance_id = ?',
    ).all(runId);
    expect(privateRows.length).toBeGreaterThan(0);
    const privateState = JSON.stringify({
      context: readPrivate(harness.workflow, runId, AI_DURABLE_MEMORY_KEYS.context),
      messages: readPrivate(harness.workflow, runId, AI_DURABLE_MEMORY_KEYS.messages),
    });
    expect(privateState).toContain('runtime-secret');
    expect(privateState).toContain('tool-context-secret');
    expect(privateState).toContain('private-input-42');
    expect(db.prepare(`SELECT max_entries, max_total_bytes
      FROM _workflow_memory_policies WHERE instance_id = ?`).get(runId)).toEqual({
      max_entries: 4_096,
      max_total_bytes: 16 * 1024 * 1024,
    });

    const privateEachRows = db.prepare(`SELECT input, output FROM workflow_steps
      WHERE instance_id = ? AND parent_step_id IS NOT NULL`).all(runId);
    expect(privateEachRows).toEqual([{ input: null, output: null }]);
    expect(harness.agents.getProgress(runId, scope)).toMatchObject({
      runId,
      status: 'completed',
      interactions: [],
    });
  });

  test('uses Torrent interaction idempotency for human approval', async () => {
    let executions = 0;
    const dangerous = defineAIAgentTool({
      inputSchema: z.object({ id: z.string() }),
      approval: { type: 'user-approval', reason: 'Confirm the durable effect.' },
      execute: () => {
        executions += 1;
        return { ok: true };
      },
    });
    const definition = approvalDefinition(
      'durable-approval',
      dangerous,
      '{"id":"approval-secret"}',
    );
    const harness = createHarness(definition, { interactionAuthority });
    const runId = await harness.agents.startAsSystem(
      harness.descriptor,
      { prompt: 'Run.', runtimeContext: {}, toolsContext: { dangerous: {} } },
      { principal: 'approval-test', reason: 'Exercise durable approval' },
    );
    const interactionId = harness.agents.getProgress(runId, scope).interactions[0]!.interactionId;
    expect(JSON.stringify(db.prepare(
      'SELECT * FROM workflow_interactions WHERE instance_id = ?',
    ).all(runId))).not.toContain('approval-secret');
    expect(JSON.stringify(readPrivate(
      harness.workflow,
      runId,
      durableToolCallKey(0, 0),
    ))).toContain('approval-secret');
    const response = approvalResponse(runId, interactionId, true);

    expect(workflow(runId)?.status).toBe('running');
    const accepted = await harness.agents.respondToApproval(response);
    expect(accepted.outcome).toBe('accepted');
    expect(workflow(runId)?.status).toBe('completed');
    expect(executions).toBe(1);

    const replay = await harness.agents.respondToApproval(response);
    expect(replay.outcome).toBe('accepted');
    expect(executions).toBe(1);
    await expect(harness.agents.respondToApproval({
      ...response,
      response: { approved: false },
    })).rejects.toMatchObject({
      code: 'WORKFLOW_INTERACTION_SUBMISSION_CONFLICT',
      status: 409,
    });
    expect(executions).toBe(1);
  });

  test('recovers an approval wait after restart without replaying the model decision', async () => {
    const raw = new Database(':memory:');
    db.dispose();
    const firstDb = createReactiveDB({ database: raw });
    defineWorkflowTables(firstDb);
    db = firstDb;
    let modelCalls = 0;
    let executions = 0;
    const dangerous = defineAIAgentTool({
      inputSchema: z.object({ id: z.string() }),
      approval: 'user-approval',
      execute: () => {
        executions += 1;
        return { ok: true };
      },
    });
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? generated([{
              type: 'tool-call', toolCallId: 'restart-1', toolName: 'dangerous',
              input: '{"id":"once"}',
            }], 'tool-calls')
          : generated([{ type: 'text', text: 'recovered' }], 'stop');
      },
    });
    const definition = defineAIAgent({
      name: 'durable-restart', version: '1', model,
      tools: { dangerous }, limits: { maxSteps: 2 },
    });
    const lifecycle: AIAgentLifecycleEvent[] = [];
    const observer: AIAgentObserver = (event) => { lifecycle.push(event); };
    const first = createHarness(definition, { interactionAuthority }, observer);
    const runId = await first.agents.startAsSystem(
      first.descriptor,
      { prompt: 'Wait.', runtimeContext: {}, toolsContext: { dangerous: {} } },
      { principal: 'restart-test', reason: 'Exercise durable restart recovery' },
    );
    const interactionId = first.agents.getProgress(runId, scope).interactions[0]!.interactionId;
    await first.workflow.dispose();
    workflows.splice(workflows.indexOf(first.workflow), 1);
    firstDb.dispose();

    const secondDb = createReactiveDB({ database: raw });
    defineWorkflowTables(secondDb);
    db = secondDb;
    const second = createHarness(definition, { interactionAuthority }, observer);
    await second.workflow.recoverInFlight();
    expect(modelCalls).toBe(1);
    await second.agents.respondToApproval(approvalResponse(runId, interactionId, true));

    expect(second.agents.getResult(runId, scope)).toMatchObject({
      status: 'completed', text: 'recovered', turns: 2,
    });
    expect(modelCalls).toBe(2);
    expect(executions).toBe(1);
    expect(lifecycle.filter((event) => event.type === 'run.started')).toHaveLength(1);
    expect(lifecycle.filter((event) => event.type === 'run.completed')).toHaveLength(1);
    expect(lifecycle.filter((event) => event.type === 'run.failed')).toHaveLength(0);
    expect(lifecycle.filter((event) => event.type === 'run.cancelled')).toHaveLength(0);
  });

  test('records one secret-safe failed terminal across tool retries and restart', async () => {
    const raw = new Database(':memory:');
    db.dispose();
    const firstDb = createReactiveDB({ database: raw });
    defineWorkflowTables(firstDb);
    db = firstDb;
    const clock = new ManualClock();
    const lifecycle: AIAgentLifecycleEvent[] = [];
    const observer: AIAgentObserver = (event) => { lifecycle.push(event); };
    const dangerous = defineAIAgentTool({
      inputSchema: z.object({}),
      execute: () => { throw new Error('provider-tool-secret'); },
    });
    const definition = defineAIAgent({
      name: 'durable-terminal-failure',
      version: '1',
      model: new MockLanguageModelV4({
        doGenerate: generated([{
          type: 'tool-call', toolCallId: 'failing-call', toolName: 'dangerous', input: '{}',
        }], 'tool-calls'),
      }),
      tools: { dangerous },
      limits: { maxSteps: 2 },
    });
    const first = createHarness(definition, { clock }, observer);
    const runId = await first.agents.startAsSystem(
      first.descriptor,
      { prompt: 'private-failure-prompt', runtimeContext: {}, toolsContext: { dangerous: {} } },
      { principal: 'failure-test', reason: 'Exercise durable terminal failure' },
    );
    expect(workflow(runId)?.status).toBe('running');
    clock.advance(1_000);
    await first.workflow.pollRetries();
    await first.workflow.advance(runId);
    clock.advance(2_000);
    await first.workflow.pollRetries();
    await first.workflow.advance(runId);
    expect(workflow(runId)?.status).toBe('failed');

    const failed = first.agents.getResult(runId, scope);
    expect(failed).toMatchObject({
      status: 'failed',
      toolCalls: 1,
      error: {
        code: 'AI_AGENT_EXECUTION_FAILED',
        message: 'Durable AI agent execution failed.',
      },
    });
    expect(first.agents.getProgress(runId, scope)).toMatchObject({
      status: 'failed',
      error: { code: 'AI_AGENT_EXECUTION_FAILED' },
    });
    expect(lifecycle.filter((event) => event.type === 'run.started')).toHaveLength(1);
    expect(lifecycle.filter((event) => event.type === 'run.failed')).toHaveLength(1);
    expect(lifecycle.filter((event) => event.type === 'run.completed')).toHaveLength(0);
    expect(lifecycle.filter((event) => event.type === 'run.cancelled')).toHaveLength(0);
    expect(lifecycle.filter((event) => event.type === 'tool.started')
      .map((event) => 'attempt' in event ? event.attempt : undefined)).toEqual([0, 1, 2]);
    expect(lifecycle.filter((event) => event.type === 'tool.failed')
      .map((event) => 'attempt' in event ? event.attempt : undefined)).toEqual([0, 1, 2]);
    const receipt = JSON.stringify(readDirectPrivate(
      first.workflow,
      runId,
      AI_DURABLE_MEMORY_KEYS.lifecycle,
    ));
    expect(receipt).not.toContain('provider-tool-secret');
    expect(receipt).not.toContain('private-failure-prompt');

    await first.workflow.dispose();
    workflows.splice(workflows.indexOf(first.workflow), 1);
    firstDb.dispose();
    const secondDb = createReactiveDB({ database: raw });
    defineWorkflowTables(secondDb);
    db = secondDb;
    const second = createHarness(definition, { clock }, observer);
    expect(second.agents.getResult(runId, scope)).toMatchObject({
      status: 'failed',
      error: { code: 'AI_AGENT_EXECUTION_FAILED' },
    });
    expect(lifecycle.filter((event) => event.type === 'run.started')).toHaveLength(1);
    expect(lifecycle.filter((event) => event.type === 'run.failed')).toHaveLength(1);
  });

  test('projects cancellation distinctly with one terminal event', async () => {
    const lifecycle: AIAgentLifecycleEvent[] = [];
    const emittedCodes: string[] = [];
    const dangerous = defineAIAgentTool({
      inputSchema: z.object({}),
      approval: 'user-approval',
      execute: () => ({ ok: true }),
    });
    const definition = approvalDefinition('durable-cancelled', dangerous);
    const harness = createHarness(
      definition,
      { interactionAuthority },
      (event) => { lifecycle.push(event); },
      (definition) => emittedCodes.push(definition.code),
    );
    const runId = await harness.agents.startAsSystem(
      harness.descriptor,
      { prompt: 'Cancel.', runtimeContext: {}, toolsContext: { dangerous: {} } },
      { principal: 'cancel-test', reason: 'Exercise durable cancellation' },
    );
    harness.workflow.cancel(runId, scope);
    expect(harness.agents.getResult(runId, scope)).toMatchObject({
      status: 'cancelled',
      error: {
        code: 'AI_AGENT_EXECUTION_CANCELLED',
        message: 'Durable AI agent run was cancelled.',
      },
    });
    expect(lifecycle.filter((event) => event.type === 'run.cancelled')).toHaveLength(1);
    expect(lifecycle.filter((event) => event.type === 'run.failed')).toHaveLength(0);
    expect(lifecycle.filter((event) => event.type === 'run.completed')).toHaveLength(0);
    expect(emittedCodes).toContain('ai.agent.run_started');
    expect(emittedCodes).toContain('ai.agent.run_cancelled');
  });

  test('fails a resumed run when Guardian authority is revoked before the tool effect', async () => {
    let executions = 0;
    let authorized = true;
    const dangerous = defineAIAgentTool({
      inputSchema: z.object({}),
      approval: 'user-approval',
      execute: () => {
        executions += 1;
        return { ok: true };
      },
    });
    const definition = approvalDefinition('durable-revocation', dangerous);
    const context = actorContext();
    const authorityStore = new WorkflowExecutionAuthorityStore(db);
    const provider: WorkflowExecutionAuthorityProvider = {
      captureActor: () => actorAuthority(authorityStore, context),
      revalidateActor: (authority) => authorized
        ? resolvedAuthority(authority, context)
        : null,
    };
    const harness = createHarness(definition, {
      interactionAuthority,
      authorityProvider: provider,
      authorityStore,
    });
    const runId = await harness.agents.startAsActor(
      harness.descriptor,
      { prompt: 'Run.', runtimeContext: {}, toolsContext: { dangerous: {} } },
      context,
      () => {
        if (!authorized) throw new Error('revoked');
      },
    );
    const interactionId = harness.agents.getProgress(runId, scope).interactions[0]!.interactionId;
    authorized = false;

    await expect(harness.agents.respondToApproval({
      ...approvalResponse(runId, interactionId, true),
      actor: { actorId: context.userId, tenantId: null },
    })).rejects.toMatchObject({ code: 'WORKFLOW_AUTHORITY_CHANGED' });
    expect(workflow(runId)).toMatchObject({ status: 'failed' });
    expect(executions).toBe(0);
  });

  test('denies cross-tenant progress, result, and approval access', async () => {
    let executions = 0;
    const dangerous = defineAIAgentTool({
      inputSchema: z.object({}),
      approval: 'user-approval',
      execute: () => {
        executions += 1;
        return { ok: true };
      },
    });
    const definition = approvalDefinition('durable-tenant-scope', dangerous);
    const tenantA = trustedSystemServiceDataScope({
      scopeKind: 'tenant',
      tenantId: 'tenant-a',
    });
    const tenantB = trustedSystemServiceDataScope({
      scopeKind: 'tenant',
      tenantId: 'tenant-b',
    });
    const harness = createHarness(definition, {
      interactionAuthority,
      tenancyMode: 'multi',
    });
    const runId = await harness.agents.startAsSystem(
      harness.descriptor,
      { prompt: 'Run.', runtimeContext: {}, toolsContext: { dangerous: {} } },
      {
        principal: 'tenant-scope-test',
        reason: 'Prove durable agent tenant isolation',
        scope: tenantA,
      },
    );
    const interactionId = harness.agents.getProgress(runId, tenantA)
      .interactions[0]!.interactionId;

    expect(captureError(() => harness.agents.getProgress(runId, tenantB))).toMatchObject({
      code: 'AI_AGENT_EXECUTION_FAILED',
      status: 404,
    });
    expect(captureError(() => harness.agents.getResult(runId, tenantB))).toMatchObject({
      code: 'AI_AGENT_EXECUTION_FAILED',
      status: 404,
    });
    await expect(harness.agents.respondToApproval({
      ...approvalResponse(runId, interactionId, true),
      actor: { actorId: 'tenant-b-reviewer', tenantId: 'tenant-b' },
      scope: tenantB,
    })).rejects.toMatchObject({
      code: 'AI_AGENT_EXECUTION_FAILED',
      status: 404,
    });
    expect(executions).toBe(0);

    await harness.agents.respondToApproval({
      ...approvalResponse(runId, interactionId, true),
      actor: { actorId: 'tenant-a-reviewer', tenantId: 'tenant-a' },
      scope: tenantA,
    });
    expect(harness.agents.getResult(runId, tenantA)).toMatchObject({
      status: 'completed',
      text: 'approved',
    });
    expect(executions).toBe(1);
  });
});

function createHarness<DEFINITION extends AnyAIAgentDefinition>(
  definition: DEFINITION,
  options: WorkflowServiceOptions = {},
  observer?: AIAgentObserver,
  emitCode?: AIAgentPlatformCodeEmitter,
) {
  const registry = new WorkflowRegistry();
  const runtime = new AIDurableAgentWorkflowRuntime(registry, {
    agents: new AIAgentRegistry(),
    ...(observer === undefined ? {} : { observer }),
    ...(emitCode === undefined ? {} : { emitCode }),
  });
  const descriptor = runtime.register(definition);
  const workflow = new WorkflowService(db, registry, {
    shutdownGraceMs: 25,
    ...options,
  });
  workflows.push(workflow);
  return {
    runtime,
    descriptor,
    workflow,
    agents: new AIDurableAgentService(runtime, { workflows: workflow }),
  };
}

class ManualClock implements WorkflowClock {
  private milliseconds = Date.parse('2030-01-01T00:00:00.000Z');
  now(): Date { return new Date(this.milliseconds); }
  advance(milliseconds: number): void { this.milliseconds += milliseconds; }
}

function approvalDefinition<
  TOOL extends AIAgentToolDefinition<any, any, any, any, any>,
>(
  name: string,
  dangerous: TOOL,
  input = '{}',
) {
  return defineAIAgent({
    name,
    version: '1',
    model: new MockLanguageModelV4({
      doGenerate: [
        generated([{
          type: 'tool-call', toolCallId: `${name}-call`, toolName: 'dangerous', input,
        }], 'tool-calls'),
        generated([{ type: 'text', text: 'approved' }], 'stop'),
      ],
    }),
    tools: { dangerous },
    limits: { maxSteps: 2 },
  });
}

function approvalResponse(runId: string, interactionId: string, approved: boolean) {
  return {
    runId,
    interactionId,
    submissionId: 'approval-submission-1',
    response: { approved },
    actor: { actorId: 'reviewer', tenantId: null },
    scope,
    assertCurrentResponder: () => undefined,
  };
}

function readPrivate(workflowService: WorkflowService, runId: string, key: string): unknown {
  const graph = getWorkflowGraphRuntime(workflowService);
  return readAIDurableMemory({
    get: (entryKey) => graph.memory.get(
      { instanceId: runId, kind: 'instance' },
      entryKey,
    )?.value,
  }, key);
}

function readDirectPrivate(
  workflowService: WorkflowService,
  runId: string,
  key: string,
): unknown {
  return getWorkflowGraphRuntime(workflowService).memory.get(
    { instanceId: runId, kind: 'instance' },
    key,
  )?.value;
}

function workflow(runId: string) {
  return db.prepare('SELECT * FROM workflow_instances WHERE instance_id = ?').get(runId) as {
    status: string;
  } | null;
}

function captureError(operation: () => unknown): unknown {
  try {
    operation();
    return null;
  } catch (error) {
    return error;
  }
}

function generated(
  content: LanguageModelV4GenerateResult['content'],
  reason: 'stop' | 'tool-calls',
): LanguageModelV4GenerateResult {
  return {
    content,
    finishReason: { unified: reason, raw: reason },
    usage,
    warnings: [],
  };
}

function actorContext(): AuthContext {
  return {
    userId: 'actor-1', email: 'actor@example.test', role: 'user', authGeneration: 0,
    sessionKind: 'web', sessionId: 'session-1', sessionGeneration: 0,
    sessionScopeKind: 'application', sessionScopeId: 'application',
  };
}

function actorAuthority(
  store: WorkflowExecutionAuthorityStore,
  context: AuthContext,
): WorkflowActorExecutionAuthority {
  const reference: AuthContextAuthorityReference = {
    version: 1, userId: context.userId, platformRole: context.role,
    authGeneration: 0, sessionKind: 'web', sessionId: 'session-1',
    mfaVerifiedAt: null, sessionGeneration: 0, clientId: null,
    identityScopes: [], sessionScopeKind: 'application', sessionScopeId: 'application',
    tenantId: null, membershipId: null, tenantKind: null, tenantRole: null,
    tenantAuthorizationGeneration: null, membershipAuthorizationGeneration: null,
    authorizationAssignmentRevision: null,
  };
  return Object.freeze({
    version: 1,
    kind: 'actor',
    reference,
    identity: Object.freeze({
      kind: 'actor', userId: context.userId, platformRole: context.role,
      scopeKind: 'application', scopeId: 'application', tenantId: null,
      membershipId: null, roles: Object.freeze(['member']), permissions: Object.freeze([]),
      allPermissions: false, authorizationRevision: 'member:1',
      sessionKind: 'web', clientId: null,
    }),
    propertiesMac: store.propertyMac({}),
  });
}

function resolvedAuthority(
  authority: WorkflowActorExecutionAuthority,
  context: AuthContext,
): WorkflowResolvedExecutionAuthority {
  return Object.freeze({
    persisted: authority,
    identity: authority.identity,
    scope: scope as ServiceDataScope,
    authContext: context,
    userProperties: Object.freeze({}),
  });
}
