/**
 * ai-agent-types.ts
 *
 * Defines the small shared contracts for Zero AI agent runs. This file owns
 * identity, timeout, and lifecycle types only; it does not execute models,
 * tools, or persistence.
 */

import type { ModelMessage } from 'ai';
import type {
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
} from '../../observability/types';

/** JSON-like contextual data made available to an agent and its tools. */
export type AIAgentContext = Record<string, unknown>;

/** Stable identity of one immutable agent definition. */
export interface AIAgentIdentity {
  readonly name: string;
  readonly version: string;
}

/** Registry reference to one exact agent version. */
export interface AIAgentReference extends AIAgentIdentity {}

/** Prompt forms accepted by an ephemeral agent run. */
export type AIAgentPrompt =
  | { readonly prompt: string | readonly ModelMessage[]; readonly messages?: never }
  | { readonly messages: readonly ModelMessage[]; readonly prompt?: never };

/** SDK 7 timeout controls, including per-tool overrides. */
export type AIAgentTimeout<TOOL_NAME extends string = string> =
  | number
  | Readonly<{
      totalMs?: number;
      stepMs?: number;
      firstChunkMs?: number;
      chunkMs?: number;
      toolMs?: number;
      tools?: Readonly<Partial<Record<`${TOOL_NAME}Ms`, number>>>;
    }>;

/** Secret-safe lifecycle event exposed to app-owned observers. */
export type AIAgentLifecycleEvent =
  | AIAgentRunEvent<'run.started'>
  | AIAgentRunEvent<'run.completed'>
  | AIAgentRunEvent<'run.cancelled'>
  | AIAgentRunEvent<'run.failed'> & { readonly error: unknown }
  | AIAgentRunEvent<'step.started'> & { readonly stepNumber: number; readonly attempt?: number }
  | AIAgentRunEvent<'tool.started'> & { readonly stepNumber: number; readonly attempt?: number; readonly toolName: string; readonly toolCallId: string }
  | AIAgentRunEvent<'tool.completed'> & { readonly stepNumber: number; readonly attempt?: number; readonly toolName: string; readonly toolCallId: string; readonly durationMs: number }
  | AIAgentRunEvent<'tool.failed'> & { readonly stepNumber: number; readonly attempt?: number; readonly toolName: string; readonly toolCallId: string; readonly durationMs: number; readonly error: unknown };

interface AIAgentRunEvent<TYPE extends string> extends AIAgentIdentity {
  readonly type: TYPE;
  readonly runId: string;
}

/** Best-effort hook for app-owned metrics and tracing adapters. */
export type AIAgentObserver = (event: AIAgentLifecycleEvent) => void | PromiseLike<void>;

/** App-bound platform-code sink used instead of the standalone global sink. */
export type AIAgentPlatformCodeEmitter = (
  definition: PlatformCodeDefinition,
  options?: PlatformCodeEmitOptions,
) => unknown;
