/**
 * ai-conversation.ts
 *
 * Owns conversation message building and normalization for Zero's AI service.
 * This file does not call providers directly, read environment variables, or
 * persist chat history.
 */

import type { ModelMessage } from '@ai-sdk/provider-utils';

import type {
  AIConversation,
  AIConversationOptions,
  AIGenerateConversationRequest,
  AIImageContentPart,
  AIMessage,
  AIMessageContent,
  AIRequestOptions,
  AIStreamResult,
  AITextContentPart,
  AITextResult,
} from './ai-types';

interface AIConversationRunner {
  generateConversation(request: AIGenerateConversationRequest): Promise<AITextResult>;
  streamConversation(request: AIGenerateConversationRequest): AIStreamResult;
}

/** Build and run a multi-turn AI conversation against an AIService-like runner. */
export class AIConversationBuilder implements AIConversation {
  private readonly messageList: AIMessage[] = [];

  /** Create a conversation builder with optional seed messages and options. */
  constructor(
    private readonly runner: AIConversationRunner,
    private readonly options: AIConversationOptions = {}
  ) {
    if (options.system) this.system(options.system);
    for (const message of options.messages ?? []) {
      this.messageList.push(message);
    }
  }

  /** Append a system message. */
  system(content: string): this {
    this.messageList.push({ role: 'system', content });
    return this;
  }

  /** Append a user message. */
  user(content: AIMessageContent): this {
    this.messageList.push({ role: 'user', content });
    return this;
  }

  /** Append an assistant message. */
  assistant(content: string | readonly AITextContentPart[]): this {
    this.messageList.push({ role: 'assistant', content });
    return this;
  }

  /** Append a tool result message. */
  tool(toolCallId: string, output: unknown, toolName = 'tool'): this {
    this.messageList.push({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId, toolName, output }],
    });
    return this;
  }

  /** Return the raw Zero message list for inspection or reuse. */
  messages(): readonly AIMessage[] {
    return [...this.messageList];
  }

  /** Generate a non-streaming assistant response from the current messages. */
  generate(options: AIRequestOptions = {}): Promise<AITextResult> {
    return this.runner.generateConversation({
      ...this.options,
      ...options,
      messages: this.messageList,
      tools: this.options.tools,
      toolChoice: this.options.toolChoice,
    });
  }

  /** Stream an assistant response from the current messages. */
  stream(options: AIRequestOptions = {}): AIStreamResult {
    return this.runner.streamConversation({
      ...this.options,
      ...options,
      messages: this.messageList,
      tools: this.options.tools,
      toolChoice: this.options.toolChoice,
    });
  }
}

/** Convert Zero AI messages to AI SDK model messages. */
export function toModelMessages(messages: readonly AIMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === 'system' || message.role === 'developer') {
      return {
        role: 'system',
        content: stringifyContent(message.content),
      };
    }

    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: normalizeToolContent(message.content),
      } as ModelMessage;
    }

    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: normalizeAssistantContent(message.content),
      } as ModelMessage;
    }

    return {
      role: 'user',
      content: normalizeUserContent(message.content),
    } as ModelMessage;
  });
}

function normalizeUserContent(content: AIMessage['content']) {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') {
      return { type: 'text' as const, text: part.text };
    }
    if (part.type === 'image') {
      return imagePartToFilePart(part);
    }
    if (part.type === 'file') {
      return {
        type: 'file' as const,
        data: part.data,
        mediaType: part.mediaType,
        filename: part.filename,
      };
    }
    return { type: 'text' as const, text: '' };
  });
}

function normalizeAssistantContent(content: AIMessage['content']) {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') {
      return { type: 'text' as const, text: part.text };
    }
    if (part.type === 'tool-call') {
      return {
        type: 'tool-call' as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      };
    }
    if (part.type === 'tool-result') {
      return {
        type: 'tool-result' as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName ?? 'tool',
        output: part.output,
      };
    }
    return { type: 'text' as const, text: '' };
  });
}

function normalizeToolContent(content: AIMessage['content']) {
  const parts = typeof content === 'string'
    ? [{ type: 'tool-result' as const, toolCallId: 'tool', toolName: 'tool', output: content }]
    : content.filter((part) => part.type === 'tool-result');

  return parts.map((part) => ({
    type: 'tool-result' as const,
    toolCallId: part.toolCallId,
    toolName: part.toolName ?? 'tool',
    output: part.output,
  }));
}

function stringifyContent(content: AIMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'image') return `[image: ${part.url}]`;
      if (part.type === 'file') return `[file: ${part.filename ?? part.mediaType}]`;
      if (part.type === 'tool-call') return `[tool-call: ${part.toolName}]`;
      return JSON.stringify(part.output);
    })
    .join('\n');
}

function imagePartToFilePart(part: AIImageContentPart) {
  return {
    type: 'file' as const,
    data: toUrlOrString(part.url),
    mediaType: part.mediaType ?? inferImageMediaType(part.url),
  };
}

function toUrlOrString(value: string): string | URL {
  try {
    return new URL(value);
  } catch {
    return value;
  }
}

function inferImageMediaType(value: string): string {
  if (value.startsWith('data:')) {
    const match = /^data:([^;,]+)/.exec(value);
    if (match?.[1]) return match[1];
  }
  if (/\.(jpe?g)(?:$|\?)/i.test(value)) return 'image/jpeg';
  if (/\.webp(?:$|\?)/i.test(value)) return 'image/webp';
  if (/\.gif(?:$|\?)/i.test(value)) return 'image/gif';
  return 'image/png';
}
