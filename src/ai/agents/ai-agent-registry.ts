/**
 * ai-agent-registry.ts
 *
 * Stores immutable AI agent definitions by exact name and version. This file
 * owns deterministic registration and lookup only; it does not execute agents
 * or choose an implicit latest version.
 */

import { AIError } from '../ai-errors';
import type { AIAgentReference } from './ai-agent-types';
import type { AnyAIAgentDefinition } from './ai-agent-definition';

/** In-memory catalog that never replaces an existing name/version binding. */
export class AIAgentRegistry {
  private readonly definitions = new Map<string, AnyAIAgentDefinition>();

  /** Register one exact immutable definition; duplicate versions are rejected. */
  register<DEFINITION extends AnyAIAgentDefinition>(definition: DEFINITION): DEFINITION {
    if (definition.kind !== 'zero.ai-agent' || !Object.isFrozen(definition)) {
      throw new AIError(
        'AI agents must be created with defineAIAgent() before registration.',
        'AI_AGENT_DEFINITION_INVALID',
        400,
      );
    }
    const key = registryKey(definition);
    if (this.definitions.has(key)) {
      throw new AIError(
        `AI agent is already registered: ${definition.name}@${definition.version}.`,
        'AI_AGENT_DEFINITION_INVALID',
        409,
      );
    }
    this.definitions.set(key, definition);
    return definition;
  }

  /** Return one exact version without selecting or falling back to another. */
  get(reference: AIAgentReference): AnyAIAgentDefinition | undefined {
    return this.definitions.get(registryKey(reference));
  }

  /** Resolve one exact version or throw a stable domain error. */
  require(reference: AIAgentReference): AnyAIAgentDefinition {
    const definition = this.get(reference);
    if (definition) return definition;
    throw new AIError(
      `AI agent is not registered: ${reference.name}@${reference.version}.`,
      'AI_AGENT_NOT_REGISTERED',
      404,
    );
  }

  /** Return a frozen snapshot sorted by name and then version. */
  list(): readonly AnyAIAgentDefinition[] {
    return Object.freeze([...this.definitions.values()].sort((left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version)));
  }
}

function registryKey(reference: AIAgentReference): string {
  return `${reference.name}\u0000${reference.version}`;
}

