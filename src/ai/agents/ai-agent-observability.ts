/**
 * ai-agent-observability.ts
 *
 * Emits secret-safe agent lifecycle events through Zero observability and an
 * optional app hook. This file shapes metadata only; it never records prompts,
 * tool inputs, tool outputs, runtime context, or approval secrets.
 */

import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import { createPublicAIError, emitAICodeSafely } from '../ai-observability';
import type {
  AIAgentLifecycleEvent,
  AIAgentObserver,
  AIAgentPlatformCodeEmitter,
} from './ai-agent-types';

/** Emit one lifecycle event without letting an observability failure alter the run. */
export function emitAIAgentLifecycle(
  event: AIAgentLifecycleEvent,
  observer: AIAgentObserver | undefined,
  emitCode: AIAgentPlatformCodeEmitter = emitPlatformCode,
): void {
  const definition = codeFor(event.type);
  const error = 'error' in event
    ? createPublicAIError(event.error, 'AI agent lifecycle operation failed.')
    : undefined;
  const identifiers = {
    name: boundedIdentifier(event.name),
    version: boundedIdentifier(event.version),
    runId: boundedIdentifier(event.runId),
  };
  const tool = 'toolName' in event
    ? {
        toolName: boundedIdentifier(event.toolName),
        toolCallId: boundedIdentifier(event.toolCallId),
      }
    : {};
  emitAICodeSafely(emitCode, definition, {
    error,
    metadata: {
      agentName: identifiers.name,
      agentVersion: identifiers.version,
      agentRunId: identifiers.runId,
      ...('stepNumber' in event ? { stepNumber: event.stepNumber } : {}),
      ...('attempt' in event && event.attempt !== undefined
        ? { attempt: event.attempt }
        : {}),
      ...tool,
      ...('durationMs' in event ? { durationMs: event.durationMs } : {}),
    },
  });

  if (!observer) return;
  try {
    const publicEvent = {
      ...event,
      ...identifiers,
      ...tool,
      ...(error === undefined ? {} : { error }),
    } as AIAgentLifecycleEvent;
    const pending = observer(publicEvent);
    if (pending) Promise.resolve(pending).catch(() => {});
  } catch {
    // Observability is best-effort and must not change model/tool behavior.
  }
}

function boundedIdentifier(value: string): string {
  return value.length <= 256 ? value : `${value.slice(0, 245)}[truncated]`;
}

function codeFor(type: AIAgentLifecycleEvent['type']) {
  switch (type) {
    case 'run.started': return OBS_CODES.AI_AGENT_RUN_STARTED;
    case 'run.completed': return OBS_CODES.AI_AGENT_RUN_COMPLETED;
    case 'run.cancelled': return OBS_CODES.AI_AGENT_RUN_CANCELLED;
    case 'run.failed': return OBS_CODES.AI_AGENT_RUN_FAILED;
    case 'step.started': return OBS_CODES.AI_AGENT_STEP_STARTED;
    case 'tool.started': return OBS_CODES.AI_AGENT_TOOL_STARTED;
    case 'tool.completed': return OBS_CODES.AI_AGENT_TOOL_COMPLETED;
    case 'tool.failed': return OBS_CODES.AI_AGENT_TOOL_FAILED;
  }
}
