/** Immutable SDK prompt projections used while preparing one agent run. */

import type { ModelMessage } from 'ai';

import type { AIAgentPrompt } from './ai-agent-types';

export function agentPromptArguments(
  input: AIAgentPrompt,
): { prompt: string | ModelMessage[] } | { messages: ModelMessage[] } {
  return 'messages' in input && input.messages !== undefined
    ? { messages: [...input.messages] }
    : { prompt: typeof input.prompt === 'string' ? input.prompt : [...input.prompt] };
}

export function agentModelMessages(input: AIAgentPrompt): ModelMessage[] {
  if ('messages' in input && input.messages !== undefined) return [...input.messages];
  if (typeof input.prompt === 'string') return [{ role: 'user', content: input.prompt }];
  return [...input.prompt];
}
