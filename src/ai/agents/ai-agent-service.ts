/**
 * ai-agent-service.ts
 *
 * Provides the small application-facing facade over the immutable registry and
 * ephemeral runner. It intentionally does not persist runs or compete with
 * Torrent's durable workflow engine.
 */

import type { OutputInterface } from 'ai';

import type { AIAgentDefinition, AnyAIAgentDefinition } from './ai-agent-definition';
import { AIAgentRegistry } from './ai-agent-registry';
import { AIAgentRunner, type AIAgentRunInput, type AIAgentRunnerOptions } from './ai-agent-runner';
import type { AIAgentContext, AIAgentReference } from './ai-agent-types';
import type { AIAgentToolSet } from './ai-agent-tool';

/** Optional dependencies for one isolated AI agent service. */
export interface AIAgentServiceOptions extends AIAgentRunnerOptions {
  readonly registry?: AIAgentRegistry;
  readonly runner?: AIAgentRunner;
}

/** Register and execute ephemeral AI agents without changing existing AI APIs. */
export class AIAgentService {
  readonly registry: AIAgentRegistry;
  readonly runner: AIAgentRunner;

  constructor(options: AIAgentServiceOptions = {}) {
    this.registry = options.registry ?? new AIAgentRegistry();
    this.runner = options.runner ?? new AIAgentRunner(options);
  }

  /** Register one immutable name/version definition. */
  register<DEFINITION extends AnyAIAgentDefinition>(definition: DEFINITION): DEFINITION {
    return this.registry.register(definition);
  }

  /** Execute one registered definition by exact version. */
  generate<
    RUNTIME_CONTEXT extends AIAgentContext,
    EXECUTION_CONTEXT,
    TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
    OUTPUT extends OutputInterface,
  >(
    reference: AIAgentReference,
    input: AIAgentRunInput<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS>,
  ) {
    const definition = this.registry.require(reference) as AIAgentDefinition<
      RUNTIME_CONTEXT,
      EXECUTION_CONTEXT,
      TOOLS,
      OUTPUT
    >;
    return this.runner.generate(definition, input);
  }

  /** Start one streaming run for a registered exact version. */
  stream<
    RUNTIME_CONTEXT extends AIAgentContext,
    EXECUTION_CONTEXT,
    TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
    OUTPUT extends OutputInterface,
  >(
    reference: AIAgentReference,
    input: AIAgentRunInput<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS>,
  ) {
    const definition = this.registry.require(reference) as AIAgentDefinition<
      RUNTIME_CONTEXT,
      EXECUTION_CONTEXT,
      TOOLS,
      OUTPUT
    >;
    return this.runner.stream(definition, input);
  }
}

