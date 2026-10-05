/**
 * ai-session.ts
 *
 * Owns transient in-memory conversation sessions for repeated server-side AI
 * calls. This file does not persist chat threads, expose routes, or choose
 * providers outside the model value supplied by app code.
*/

import type { ToolSet } from 'ai';
import type { Context } from '@ai-sdk/provider-utils';

import type {
  AIGenerationOptions,
  AIGenerateConversationRequest,
  AIConversationSession,
  AIConversationSessionOptions,
  AIMessage,
  AIMessageContent,
  AITextResult,
} from './ai-types';
import type { AIAnyOutput, AIOutputSpec } from './ai-output';
import { AIError } from './ai-errors';
import {
  snapshotAISessionControls,
  snapshotAISessionMessage,
  validateAISessionRetention,
} from './ai-session-snapshot';

interface AIConversationSessionRunner<
  Tools extends ToolSet,
  RuntimeContext extends Context,
> {
  generateConversation<
    Output extends AIOutputSpec,
  >(request: AIGenerateConversationRequest<Tools, RuntimeContext, Output>):
    Promise<AITextResult<Tools, RuntimeContext, Output>>;
}

/** Bounded, non-persistent helper for reusing recent messages across calls. */
export class AIConversationSessionBuilder<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
> implements AIConversationSession<Tools, RuntimeContext> {
  private readonly messageList: AIMessage[] = [];
  private readonly options: AIConversationSessionOptions<Tools, RuntimeContext>;
  private tail: Promise<void> = Promise.resolve();
  private historyRevision = 0;

  /**
   * Create a session over an AIService-like runner.
   *
   * `maxMessages` and `maxCharacters` bound only the local in-memory history;
   * they do not persist or summarize messages.
   */
  constructor(
    private readonly runner: AIConversationSessionRunner<Tools, RuntimeContext>,
    options: AIConversationSessionOptions<Tools, RuntimeContext> = {}
  ) {
    validateAISessionRetention(options);
    const { messages, maxMessages, maxCharacters, ...generation } = options;
    this.options = { ...snapshotAISessionControls(generation),
      maxMessages: options.maxMessages, maxCharacters: options.maxCharacters,
    };
    if (this.options.system) this.messageList.push({ role: 'system', content: this.options.system });
    if (messages) this.messageList.push(...messages.map(snapshotAISessionMessage));
    this.trim();
  }

  /** Append a message to the local history and apply configured bounds. */
  append(message: AIMessage): this {
    const snapshot = snapshotAISessionMessage(message);
    this.historyRevision += 1;
    this.appendOwned(snapshot);
    return this;
  }

  /** Append a user message without calling a provider. */
  user(content: AIMessageContent): this {
    return this.append({ role: 'user', content });
  }

  /** Append an assistant message without calling a provider. */
  assistant(content: string): this {
    return this.append({ role: 'assistant', content });
  }

  /** Return the current bounded message list. */
  messages(): readonly AIMessage[] {
    return this.messageList.map(snapshotAISessionMessage);
  }

  /** Clear all messages except the configured system message, when present. */
  clear(): this {
    this.historyRevision += 1;
    this.messageList.length = 0;
    if (this.options.system) this.messageList.push({ role: 'system', content: this.options.system });
    return this;
  }

  /**
   * Append one user input, generate a response with all current messages, and
   * append the assistant text result back into the local history. Sends execute
   * FIFO within this session; manual history replacement fences old completions.
   */
  async send<Output extends AIOutputSpec = AIAnyOutput>(
    content: AIMessageContent,
    options: Omit<AIGenerationOptions<Tools, RuntimeContext, Output>, 'tools'> = {}
  ): Promise<AITextResult<Tools, RuntimeContext, Output>> {
    const message = snapshotAISessionMessage({ role: 'user', content });
    const controls = snapshotAISessionControls(options);
    const revision = this.historyRevision;
    const operation = this.tail.then(async () => {
      if (revision !== this.historyRevision) {
        throw new AIError('Session history changed before the queued request started.', 'AI_REQUEST_ABORTED', 499);
      }
      this.appendOwned(message);
      const result = await this.runner.generateConversation({
        ...this.options,
        ...controls,
        messages: this.messages(),
        tools: this.options.tools,
        toolChoice: this.options.toolChoice,
      });
      if (revision === this.historyRevision) {
        this.appendOwned({ role: 'assistant', content: result.text });
      }
      return result;
    });
    // Only the queue dependency consumes failure; the caller's operation keeps
    // its rejection, and later work is not poisoned by an earlier failed turn.
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private appendOwned(message: AIMessage): void {
    this.messageList.push(message);
    this.trim();
  }

  private trim(): void {
    const maxMessages = this.options.maxMessages ?? 32;
    const system = this.messageList.find((message) => message.role === 'system');

    while (this.messageList.length > maxMessages) {
      const removeIndex = this.messageList.findIndex((message, index) => index > 0 || message.role !== 'system');
      if (removeIndex < 0) break;
      this.messageList.splice(removeIndex, 1);
    }

    const maxCharacters = this.options.maxCharacters;
    if (maxCharacters && maxCharacters > 0) {
      while (estimateMessageCharacters(this.messageList) > maxCharacters && this.messageList.length > 1) {
        const removeIndex = this.messageList.findIndex((message) => message !== system);
        if (removeIndex < 0) break;
        this.messageList.splice(removeIndex, 1);
      }
    }
  }
}

function estimateMessageCharacters(messages: readonly AIMessage[]): number {
  return messages.reduce((total, message) => total + JSON.stringify(message.content).length, 0);
}
