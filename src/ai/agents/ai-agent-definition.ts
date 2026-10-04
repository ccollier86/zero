/**
 * ai-agent-definition.ts
 *
 * Defines and validates immutable, versioned Zero AI agent blueprints. This
 * module owns declarative model policy only; it does not register or execute
 * agents.
 */

import type {
  FlexibleSchema,
  Instructions,
  LanguageModel,
  LanguageModelCallOptions,
  OutputInterface,
} from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';

import { AIError } from '../ai-errors';
import { normalizeAIProviderOptions } from '../ai-provider-options';
import type { AIAgentApprovalPolicy } from './ai-agent-approval';
import {
  assertAIAgentApprovalRule,
  isAIAgentApprovalStatusObject,
} from './ai-agent-approval-status';
import {
  resolveAIAgentLimits,
  resolveAIAgentTimeout,
  type AIAgentLimits,
  type ResolvedAIAgentLimits,
} from './ai-agent-limits';
import type { AIAgentContext, AIAgentIdentity, AIAgentTimeout } from './ai-agent-types';
import type { AIAgentToolSet } from './ai-agent-tool';

const AGENT_NAME = /^[a-z][a-z0-9._-]{0,127}$/;
const AGENT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Immutable definition consumed by the registry and runner. */
export interface AIAgentDefinition<
  RUNTIME_CONTEXT extends AIAgentContext = AIAgentContext,
  EXECUTION_CONTEXT = undefined,
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT> = AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
  OUTPUT extends OutputInterface = never,
> extends AIAgentIdentity {
  readonly kind: 'zero.ai-agent';
  /** Concrete SDK model or a Zero model alias/provider-qualified reference. */
  readonly model: LanguageModel | string;
  readonly instructions?: Instructions;
  readonly tools: TOOLS;
  readonly runtimeContextSchema?: FlexibleSchema<RUNTIME_CONTEXT>;
  readonly output?: OUTPUT;
  readonly approval?: AIAgentApprovalPolicy<TOOLS, RUNTIME_CONTEXT, EXECUTION_CONTEXT>;
  readonly limits: ResolvedAIAgentLimits;
  readonly timeout?: AIAgentTimeout<keyof TOOLS & string>;
  readonly maxRetries?: number;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly stopSequences?: readonly string[];
  readonly seed?: number;
  readonly reasoning?: LanguageModelCallOptions['reasoning'];
  readonly providerOptions?: ProviderOptions;
}

/** Declaration accepted by `defineAIAgent`; Zero supplies normalized fields. */
export type AIAgentDefinitionInput<
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
  OUTPUT extends OutputInterface,
> = Omit<AIAgentDefinition<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS, OUTPUT>, 'kind' | 'limits' | 'timeout' | 'tools' | 'stopSequences'> & {
  readonly tools: TOOLS;
  readonly limits?: AIAgentLimits;
  readonly timeout?: AIAgentTimeout<keyof TOOLS & string>;
  readonly stopSequences?: readonly string[];
};

/** Any typed agent definition accepted by heterogeneous registries. */
export type AnyAIAgentDefinition = AIAgentDefinition<any, any, any, any>;

/** Define, validate, copy, and freeze a versioned agent blueprint. */
export function defineAIAgent<
  RUNTIME_CONTEXT extends AIAgentContext = AIAgentContext,
  EXECUTION_CONTEXT = undefined,
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT> = AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
  OUTPUT extends OutputInterface = never,
>(
  input: AIAgentDefinitionInput<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS, OUTPUT>,
): AIAgentDefinition<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS, OUTPUT> {
  assertIdentity(input);
  if (!input.model) throw invalid('AI agent model is required.');
  if (typeof input.model === 'string'
    && (input.model.trim().length === 0 || input.model.length > 512)) {
    throw invalid('AI agent model references must contain 1 through 512 characters.');
  }

  const tools = copyAndValidateTools(input.tools);
  const timeout = resolveAIAgentTimeout(input.timeout, Object.keys(tools) as Array<keyof TOOLS & string>);
  const approval = copyApprovalPolicy(input.approval, tools);
  const instructions = copyInstructions(input.instructions);
  const providerOptions = normalizeAIProviderOptions(input.providerOptions);
  assertOptionalInteger('maxRetries', input.maxRetries, 0, 5);
  assertOptionalInteger('maxOutputTokens', input.maxOutputTokens, 1, 1_000_000);
  assertOptionalInteger('seed', input.seed, -2_147_483_648, 2_147_483_647);
  assertOptionalNumber('temperature', input.temperature, 0, 2);
  assertOptionalNumber('topP', input.topP, 0, 1);
  assertOptionalNumber('topK', input.topK, 0, Number.MAX_SAFE_INTEGER);
  assertOptionalNumber('presencePenalty', input.presencePenalty, -2, 2);
  assertOptionalNumber('frequencyPenalty', input.frequencyPenalty, -2, 2);

  return Object.freeze({
    ...input,
    kind: 'zero.ai-agent' as const,
    name: input.name.trim(),
    version: input.version.trim(),
    model: typeof input.model === 'string' ? input.model.trim() : input.model,
    ...(instructions === undefined ? {} : { instructions }),
    tools,
    ...(approval === undefined ? {} : { approval }),
    limits: resolveAIAgentLimits(input.limits),
    ...(timeout === undefined ? {} : { timeout }),
    ...(input.stopSequences === undefined
      ? {}
      : { stopSequences: Object.freeze([...input.stopSequences]) }),
    ...(providerOptions === undefined ? {} : { providerOptions: Object.freeze(providerOptions) }),
  });
}

function copyInstructions(instructions: Instructions | undefined): Instructions | undefined {
  if (instructions === undefined || typeof instructions === 'string') return instructions;
  const messages = Array.isArray(instructions) ? instructions : [instructions];
  const copied = messages.map((message) => Object.freeze({
    role: 'system' as const,
    content: message.content,
    ...(message.providerOptions === undefined
      ? {}
      : { providerOptions: Object.freeze(normalizeAIProviderOptions(message.providerOptions)) }),
  }));
  return Array.isArray(instructions) ? Object.freeze(copied) as unknown as Instructions : copied[0];
}

function copyApprovalPolicy<POLICY, TOOLS extends AIAgentToolSet<any, any>>(
  policy: POLICY,
  tools: TOOLS,
): POLICY {
  if (policy === undefined || typeof policy === 'function' || typeof policy === 'string') {
    assertAIAgentApprovalRule(policy, 'AI agent approval');
    return policy;
  }
  if (isAIAgentApprovalStatusObject(policy)) {
    assertAIAgentApprovalRule(policy, 'AI agent approval');
    return Object.freeze({ ...policy }) as POLICY;
  }
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
    throw invalid('AI agent approval must be a status, policy function, or per-tool map.');
  }
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [name, rule] of Object.entries(policy)) {
    if (!Object.prototype.hasOwnProperty.call(tools, name)) {
      throw invalid(`AI agent approval references an unknown tool: ${name}.`);
    }
    assertAIAgentApprovalRule(rule, `AI agent approval for ${name}`);
    copy[name] = isAIAgentApprovalStatusObject(rule) ? Object.freeze({ ...rule }) : rule;
  }
  return Object.freeze(copy) as POLICY;
}

function assertIdentity(identity: AIAgentIdentity): void {
  if (!AGENT_NAME.test(identity.name.trim())) {
    throw invalid('AI agent names must start with a lowercase letter and contain only lowercase letters, numbers, dot, underscore, or hyphen.');
  }
  if (!AGENT_VERSION.test(identity.version.trim())) {
    throw invalid('AI agent versions must contain only letters, numbers, dot, underscore, plus, or hyphen.');
  }
}

function copyAndValidateTools<TOOLS extends AIAgentToolSet<any, any>>(tools: TOOLS): TOOLS {
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) {
    throw invalid('AI agent tools must be an object map.');
  }
  const copy = Object.create(null) as Record<string, unknown>;
  for (const [name, definition] of Object.entries(tools)) {
    if (!TOOL_NAME.test(name) || RESERVED_KEYS.has(name)) {
      throw invalid(`Invalid AI agent tool name: ${name}.`);
    }
    if (definition?.kind !== 'zero.ai-agent-tool' || !Object.isFrozen(definition)) {
      throw invalid(`AI agent tool ${name} must be created with defineAIAgentTool().`);
    }
    copy[name] = definition;
  }
  return Object.freeze(copy) as TOOLS;
}

function assertOptionalInteger(name: string, value: number | undefined, min: number, max: number): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw invalid(`${name} must be an integer from ${min} through ${max}.`);
  }
}

function assertOptionalNumber(name: string, value: number | undefined, min: number, max: number): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw invalid(`${name} must be a number from ${min} through ${max}.`);
  }
}

function invalid(message: string): AIError {
  return new AIError(message, 'AI_AGENT_DEFINITION_INVALID', 400);
}
