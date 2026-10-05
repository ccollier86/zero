/**
 * Detaches session history and mutable generation controls without serializing
 * callbacks or app service contexts. This module owns local snapshots only;
 * provider admission, execution, authorization and persistence remain elsewhere.
 */

import type { ToolSet } from 'ai';
import type { Context } from '@ai-sdk/provider-utils';

import { AIError } from './ai-errors';
import { normalizeAIProviderOptions } from './ai-provider-options';
import {
  snapshotAIHeaders,
  snapshotAIStringList,
  snapshotAITimeout,
  snapshotAIToolApprovalSecret,
} from './ai-request-snapshot';
import type { AIGenerationOptions, AIConversationSessionOptions, AIMessage } from './ai-types';
import type { AIAnyOutput, AIOutputSpec } from './ai-output';

/** Clone supported message data, including binary and URL file inputs. */
export function snapshotAISessionMessage(message: AIMessage): AIMessage {
  try {
    return clone(message, new Set<object>(), 0, { nodes: 0 }) as AIMessage;
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw invalidMessage();
  }
}

/** Validate explicit retention knobs while preserving approximate pruning policy. */
export function validateAISessionRetention(
  options: Pick<AIConversationSessionOptions, 'maxMessages' | 'maxCharacters'>,
): void {
  for (const name of ['maxMessages', 'maxCharacters'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new AIError(`${name} must be a positive safe integer.`, 'AI_REQUEST_INVALID', 400);
    }
  }
}

/** Capture mutable options while preserving typed callback/context identities. */
export function snapshotAISessionControls<
  Tools extends ToolSet,
  RuntimeContext extends Context,
  Output extends AIOutputSpec = AIAnyOutput,
>(
  options: AIGenerationOptions<Tools, RuntimeContext, Output>,
): AIGenerationOptions<Tools, RuntimeContext, Output> {
  return {
    ...options,
    ...(options.headers === undefined ? {} : { headers: snapshotAIHeaders(options.headers) }),
    ...(options.providerOptions === undefined ? {} : { providerOptions: normalizeAIProviderOptions(options.providerOptions) }),
    ...(options.timeout === undefined ? {} : { timeout: snapshotAITimeout(options.timeout) }),
    ...(options.stopSequences === undefined ? {} : { stopSequences: snapshotAIStringList(options.stopSequences, 'stopSequences') }),
    ...(options.activeTools === undefined ? {} : { activeTools: snapshotAIStringList(options.activeTools, 'activeTools') }),
    ...(options.toolOrder === undefined ? {} : { toolOrder: snapshotAIStringList(options.toolOrder, 'toolOrder') }),
    ...(options.toolApprovalSecret === undefined ? {} : { toolApprovalSecret: snapshotAIToolApprovalSecret(options.toolApprovalSecret) }),
    ...(typeof options.instructions !== 'object' ? {} : {
      instructions: clone(options.instructions, new Set<object>(), 0, { nodes: 0 }) as typeof options.instructions,
    }),
    ...(typeof options.toolChoice !== 'object' ? {} : { toolChoice: { ...options.toolChoice } }),
    ...(Array.isArray(options.stopWhen) ? { stopWhen: [...options.stopWhen] } : {}),
    ...(options.tools === undefined ? {} : { tools: { ...options.tools } }),
    ...(options.metadata === undefined ? {} : { metadata: { ...options.metadata } }),
  };
}

function clone(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  state: { nodes: number },
): unknown {
  if (++state.nodes > 100_000 || depth > 64) {
    throw new AIError('Session message data exceeds the complexity limit.', 'AI_REQUEST_LIMIT_EXCEEDED', 413);
  }
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (value instanceof URL) return new URL(value.href);
  if (typeof value !== 'object' || ancestors.has(value)) throw invalidMessage();

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw invalidMessage();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).length !== value.length + 1) throw invalidMessage();
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw invalidMessage();
        return clone(descriptor.value, ancestors, depth + 1, state);
      });
    }
    const result: Record<string, unknown> = {};
    for (const name of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (typeof name !== 'string' || !descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw invalidMessage();
      }
      Object.defineProperty(result, name, {
        value: clone(descriptor.value, ancestors, depth + 1, state),
        enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function invalidMessage(): AIError {
  return new AIError('Session messages must contain supported plain data.', 'AI_REQUEST_INVALID', 400);
}
