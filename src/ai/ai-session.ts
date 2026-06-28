/**
 * ai-session.ts
 *
 * Owns transient in-memory conversation sessions for repeated server-side AI
 * calls. This file does not persist chat threads, expose routes, or choose
 * providers outside the model value supplied by app code.
 */

import type {
  AIGenerateConversationRequest,
  AIConversationSession,
  AIConversationSessionOptions,
  AIMessage,
  AIMessageContent,
  AIRequestOptions,
  AITextResult,
} from './ai-types';

interface AIConversationSessionRunner {
  generateConversation(request: AIGenerateConversationRequest): Promise<AITextResult>;
}

/** Bounded, non-persistent helper for reusing recent messages across calls. */
export class AIConversationSessionBuilder implements AIConversationSession {
  private readonly messageList: AIMessage[] = [];

  /**
   * Create a session over an AIService-like runner.
   *
   * `maxMessages` and `maxCharacters` bound only the local in-memory history;
   * they do not persist or summarize messages.
   */
  constructor(
    private readonly runner: AIConversationSessionRunner,
    private readonly options: AIConversationSessionOptions = {}
  ) {
    if (options.system) this.messageList.push({ role: 'system', content: options.system });
    if (options.messages) this.messageList.push(...options.messages);
    this.trim();
  }

  /** Append a message to the local history and apply configured bounds. */
  append(message: AIMessage): this {
    this.messageList.push(message);
    this.trim();
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
    return [...this.messageList];
  }

  /** Clear all messages except the configured system message, when present. */
  clear(): this {
    this.messageList.length = 0;
    if (this.options.system) this.messageList.push({ role: 'system', content: this.options.system });
    return this;
  }

  /**
   * Append one user input, generate a response with all current messages, and
   * append the assistant text result back into the local history.
   */
  async send(content: AIMessageContent, options: AIRequestOptions = {}): Promise<AITextResult> {
    this.user(content);
    const result = await this.runner.generateConversation({
      ...this.options,
      ...options,
      messages: this.messageList,
      tools: this.options.tools,
      toolChoice: this.options.toolChoice,
    });
    this.assistant(result.text);
    return result;
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
