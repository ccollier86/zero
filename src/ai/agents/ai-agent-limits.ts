/**
 * ai-agent-limits.ts
 *
 * Validates the bounded execution and timeout policy for Zero AI agents. This
 * module owns admission limits only; it does not count runtime work or call the
 * AI SDK.
 */

import { AIError } from '../ai-errors';
import type { AIAgentTimeout } from './ai-agent-types';

/** Developer-configurable work and memory budgets for one agent run. */
export interface AIAgentLimits {
  readonly maxSteps?: number;
  readonly maxToolCalls?: number;
  readonly maxToolCallsPerStep?: number;
  readonly maxContextBytes?: number;
  readonly maxToolResultBytes?: number;
  readonly maxTotalToolResultBytes?: number;
}

/** Canonical limits used by the runtime after validation. */
export type ResolvedAIAgentLimits = Required<AIAgentLimits>;

/** Conservative defaults that bound every run even when an app omits limits. */
export const DEFAULT_AI_AGENT_LIMITS: Readonly<ResolvedAIAgentLimits> = Object.freeze({
  maxSteps: 20,
  maxToolCalls: 64,
  maxToolCallsPerStep: 8,
  maxContextBytes: 256 * 1024,
  maxToolResultBytes: 256 * 1024,
  maxTotalToolResultBytes: 1024 * 1024,
});

const HARD_LIMITS: Readonly<ResolvedAIAgentLimits> = Object.freeze({
  maxSteps: 64,
  maxToolCalls: 512,
  maxToolCallsPerStep: 64,
  maxContextBytes: 8 * 1024 * 1024,
  maxToolResultBytes: 8 * 1024 * 1024,
  maxTotalToolResultBytes: 32 * 1024 * 1024,
});

const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const LIMIT_KEYS = new Set(Object.keys(DEFAULT_AI_AGENT_LIMITS));
const TIMEOUT_KEYS = new Set(['totalMs', 'stepMs', 'firstChunkMs', 'chunkMs', 'toolMs', 'tools']);

/** Validate, copy, and freeze an agent execution budget. */
export function resolveAIAgentLimits(input: AIAgentLimits | undefined): ResolvedAIAgentLimits {
  for (const key of Object.keys(input ?? {})) {
    if (!LIMIT_KEYS.has(key)) throw invalidDefinition(`Unknown AI agent limit: ${key}.`);
  }
  const resolved = {
    ...DEFAULT_AI_AGENT_LIMITS,
    ...input,
  };

  for (const key of Object.keys(HARD_LIMITS) as Array<keyof ResolvedAIAgentLimits>) {
    assertBoundedInteger(key, resolved[key], 1, HARD_LIMITS[key]);
  }
  if (resolved.maxToolCallsPerStep > resolved.maxToolCalls) {
    throw invalidDefinition('maxToolCallsPerStep cannot exceed maxToolCalls.');
  }
  if (resolved.maxToolResultBytes > resolved.maxTotalToolResultBytes) {
    throw invalidDefinition('maxToolResultBytes cannot exceed maxTotalToolResultBytes.');
  }

  return Object.freeze(resolved);
}

/** Validate and defensively copy every SDK 7 timeout field. */
export function resolveAIAgentTimeout<TOOL_NAME extends string>(
  timeout: AIAgentTimeout<TOOL_NAME> | undefined,
  toolNames: readonly TOOL_NAME[],
): AIAgentTimeout<TOOL_NAME> | undefined {
  if (timeout === undefined) return undefined;
  if (typeof timeout === 'number') {
    assertTimeout('timeout', timeout);
    return timeout;
  }

  for (const key of Object.keys(timeout)) {
    if (!TIMEOUT_KEYS.has(key)) throw invalidDefinition(`Unknown AI agent timeout field: ${key}.`);
  }

  const resolved: Exclude<AIAgentTimeout<TOOL_NAME>, number> = {};
  for (const key of ['totalMs', 'stepMs', 'firstChunkMs', 'chunkMs', 'toolMs'] as const) {
    const value = timeout[key];
    if (value !== undefined) {
      assertTimeout(key, value);
      (resolved as Record<string, unknown>)[key] = value;
    }
  }

  if (timeout.tools !== undefined) {
    const allowed = new Set(toolNames.map((name) => `${name}Ms`));
    const tools: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const [key, value] of Object.entries(timeout.tools)) {
      if (!allowed.has(key)) {
        throw invalidDefinition(`Unknown per-tool timeout: ${key}.`);
      }
      if (typeof value !== 'number') {
        throw invalidDefinition(`tools.${key} must be a number.`);
      }
      assertTimeout(`tools.${key}`, value);
      tools[key] = value;
    }
    (resolved as { tools?: Readonly<Record<string, number>> }).tools = Object.freeze(tools);
  }

  return Object.freeze(resolved);
}

function assertBoundedInteger(
  name: keyof ResolvedAIAgentLimits,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalidDefinition(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
}

function assertTimeout(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw invalidDefinition(`${name} must be an integer from 1 through ${MAX_TIMEOUT_MS} milliseconds.`);
  }
}

function invalidDefinition(message: string): AIError {
  return new AIError(message, 'AI_AGENT_DEFINITION_INVALID', 400);
}
