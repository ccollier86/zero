/**
 * Reconciles secret-safe AI run lifecycle receipts from committed Torrent rows.
 *
 * The private receipt is the once-only fence across activity retries and
 * process restart. App observers remain best-effort; durable run state and the
 * scope-checked result/progress projection are authoritative.
 */

import type { WorkflowGraphRuntime } from '../../workflows/workflow-graph-runtime';
import type { WorkflowInstanceRecord } from '../../workflows/types';
import { AIError, type AIErrorCode } from '../ai-errors';
import type { AIAgentLifecycleEvent } from '../agents/ai-agent-types';
import { readAIDurablePublicEnvelope } from './ai-durable-agent-envelope';
import {
  AI_DURABLE_MEMORY_KEYS,
  requireDurableLifecycleState,
} from './ai-durable-agent-state';
import type {
  AIDurableAgentLifecycleState,
  AIDurableAgentTerminalError,
} from './ai-durable-agent-types';
import type { AIDurableAgentWorkflowRuntime } from './ai-durable-agent-workflow';

const INITIAL_LIFECYCLE: AIDurableAgentLifecycleState = Object.freeze({
  version: 1,
  startedAt: null,
  terminal: null,
});

/** Own one durable lifecycle subscription for one authority-scoped facade. */
export class AIDurableAgentLifecycleCoordinator {
  private readonly unsubscribe: () => void;

  constructor(
    private readonly runtime: AIDurableAgentWorkflowRuntime<any, any>,
    private readonly graph: WorkflowGraphRuntime,
  ) {
    this.unsubscribe = graph.observeInstances(
      ({ instance }) => this.reconcileQuietly(instance),
      {
        replay: true,
        names: runtime.list().map((entry) => entry.workflowName),
      },
    );
  }

  /** Return the persisted receipt after filling any missed committed transition. */
  reconcile(instance: WorkflowInstanceRecord): AIDurableAgentLifecycleState {
    const envelope = readAIDurablePublicEnvelope(instance.input);
    if (!envelope) throw corruptLifecycle();
    const descriptor = this.runtime.require(envelope.agent.name, envelope.agent.version);
    if (instance.name !== descriptor.workflowName
      || instance.definition_version !== descriptor.workflowVersion) {
      throw corruptLifecycle();
    }

    const events: AIAgentLifecycleEvent[] = [];
    const scope = { instanceId: instance.instance_id, kind: 'instance' as const };
    const state = this.graph.memory.transaction(scope, undefined, (memory) => {
      const existing = memory.get(AI_DURABLE_MEMORY_KEYS.lifecycle);
      const current = existing === null
        ? INITIAL_LIFECYCLE
        : requireDurableLifecycleState(existing.value);
      let next = current;
      if (current.startedAt === null) {
        next = { ...next, startedAt: instance.created_at };
        events.push({
          type: 'run.started',
          name: envelope.agent.name,
          version: envelope.agent.version,
          runId: instance.instance_id,
        });
      }

      const terminal = terminalProjection(instance);
      if (terminal !== null) {
        if (next.terminal !== null && next.terminal.status !== terminal.status) {
          throw corruptLifecycle();
        }
        if (next.terminal === null) {
          next = { ...next, terminal };
          events.push(terminalEvent(instance.instance_id, envelope.agent, terminal));
        }
      } else if (next.terminal !== null) {
        throw corruptLifecycle();
      }

      if (next !== current) {
        memory.set(AI_DURABLE_MEMORY_KEYS.lifecycle, next, {
          expectedVersion: existing?.version ?? null,
        });
      }
      return next;
    });

    // Emit only after the receipt commit. A retry/restart therefore sees the
    // marker and cannot publish a second logical run event.
    for (const event of events) this.runtime.emitLifecycle(event);
    return state;
  }

  dispose(): void {
    this.unsubscribe();
  }

  private reconcileQuietly(instance: WorkflowInstanceRecord): void {
    try {
      this.reconcile(instance);
    } catch {
      // Committed workflow delivery cannot be rolled back by optional AI
      // observability. Scope-checked reads retry reconciliation and surface a
      // stable AI state error if the private receipt is actually corrupt.
    }
  }
}

function terminalProjection(
  instance: WorkflowInstanceRecord,
): NonNullable<AIDurableAgentLifecycleState['terminal']> | null {
  if (instance.status !== 'completed'
    && instance.status !== 'failed'
    && instance.status !== 'cancelled') return null;
  const at = instance.completed_at ?? instance.updated_at;
  if (instance.status === 'completed') return { status: 'completed', at };
  return {
    status: instance.status,
    at,
    error: safeTerminalError(instance.status, instance.error),
  };
}

function terminalEvent(
  runId: string,
  agent: Readonly<{ name: string; version: string }>,
  terminal: NonNullable<AIDurableAgentLifecycleState['terminal']>,
): AIAgentLifecycleEvent {
  if (terminal.status === 'completed') {
    return { type: 'run.completed', ...agent, runId };
  }
  if (terminal.status === 'cancelled') {
    return { type: 'run.cancelled', ...agent, runId };
  }
  const error = terminal.error ?? safeTerminalError('failed', null);
  return {
    type: 'run.failed',
    ...agent,
    runId,
    error: new AIError(error.message, error.code, statusFor(error.code)),
  };
}

function safeTerminalError(
  status: 'failed' | 'cancelled',
  internal: string | null,
): AIDurableAgentTerminalError {
  if (status === 'cancelled') {
    return {
      code: 'AI_AGENT_EXECUTION_CANCELLED',
      message: 'Durable AI agent run was cancelled.',
    };
  }
  if (internal?.startsWith('Durable AI agent exceeded its ')
    && internal.endsWith('-step limit.')) {
    return {
      code: 'AI_AGENT_EXECUTION_LIMIT_EXCEEDED',
      message: 'Durable AI agent exceeded its configured execution limit.',
    };
  }
  if (internal?.toLowerCase().includes('timed out')) {
    return {
      code: 'AI_AGENT_EXECUTION_TIMEOUT',
      message: 'Durable AI agent execution timed out.',
    };
  }
  return {
    code: 'AI_AGENT_EXECUTION_FAILED',
    message: 'Durable AI agent execution failed.',
  };
}

function statusFor(code: AIErrorCode): number {
  if (code === 'AI_AGENT_EXECUTION_LIMIT_EXCEEDED') return 429;
  if (code === 'AI_AGENT_EXECUTION_TIMEOUT') return 504;
  return 500;
}

function corruptLifecycle(): AIError {
  return new AIError(
    'Durable AI agent lifecycle state is invalid.',
    'AI_AGENT_EXECUTION_FAILED',
    500,
  );
}
