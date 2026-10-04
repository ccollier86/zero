/**
 * Bedrock compatibility for completed tool history on text-only turns.
 *
 * Bedrock Converse rejects native tool-use/result blocks without a current
 * tool configuration. The official adapter therefore removes those blocks.
 * Zero instead projects completed history into bounded, non-executable text
 * when the current call has no active tools.
 */

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Message,
  LanguageModelV4ToolCallPart,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4ToolResultPart,
  ProviderV4,
} from '@ai-sdk/provider';

import { AIError } from '../ai-errors';

/** Maximum synthesized UTF-8 history sent in one Bedrock model call. */
export const BEDROCK_INACTIVE_TOOL_HISTORY_MAX_BYTES = 1024 * 1024;

/** Wrap only Bedrock language models while retaining every other provider surface. */
export function preserveBedrockInactiveToolHistory(provider: ProviderV4): ProviderV4 {
  const createLanguageModel = provider.languageModel.bind(provider);
  const languageModel: ProviderV4['languageModel'] = (modelId) =>
    wrapBedrockLanguageModel(createLanguageModel(modelId));

  return new Proxy(provider, {
    get(target, property) {
      if (property === 'languageModel') return languageModel;
      return Reflect.get(target, property, target);
    },
  });
}

function wrapBedrockLanguageModel(model: LanguageModelV4): LanguageModelV4 {
  const doGenerate = model.doGenerate.bind(model);
  const doStream = model.doStream.bind(model);

  return new Proxy(model, {
    get(target, property) {
      if (property === 'doGenerate') {
        return (options: LanguageModelV4CallOptions) =>
          doGenerate(projectInactiveToolHistory(options));
      }
      if (property === 'doStream') {
        return (options: LanguageModelV4CallOptions) =>
          doStream(projectInactiveToolHistory(options));
      }
      return Reflect.get(target, property, target);
    },
  });
}

/** Return the original options unless native history would be removed upstream. */
export function projectInactiveToolHistory(
  options: LanguageModelV4CallOptions,
): LanguageModelV4CallOptions {
  if (hasActiveTools(options)) return options;

  const budget = new SynthesizedTextBudget(BEDROCK_INACTIVE_TOOL_HISTORY_MAX_BYTES);
  let changed = false;
  const prompt = options.prompt.map((message): LanguageModelV4Message => {
    if (message.role === 'assistant') {
      let messageChanged = false;
      const content = message.content.map((part) => {
        if (part.type === 'tool-call') {
          changed = true;
          messageChanged = true;
          return textPart(budget.capture(formatToolCall(part)));
        }
        if (part.type === 'tool-result') {
          changed = true;
          messageChanged = true;
          return textPart(budget.capture(formatToolResult(part)));
        }
        return part;
      });
      return messageChanged ? { ...message, content } : message;
    }

    if (message.role === 'tool') {
      if (message.content.length === 0) {
        throw invalidHistoryError('an empty tool message cannot be projected safely');
      }
      changed = true;
      const content = message.content.map((part) => textPart(budget.capture(
        part.type === 'tool-result'
          ? formatToolResult(part)
          : formatToolApproval(part),
      )));
      // Tool-role provider options describe native tool blocks. Carrying them
      // onto a synthesized user message would give them a different meaning.
      return {
        role: 'user',
        content,
      };
    }

    return message;
  });

  return changed ? { ...options, prompt } : options;
}

function hasActiveTools(options: LanguageModelV4CallOptions): boolean {
  return Boolean(options.tools?.length) && options.toolChoice?.type !== 'none';
}

function formatToolCall(part: LanguageModelV4ToolCallPart): string {
  return [
    '[Zero historical tool call; inactive for this request]',
    `Call ID: ${quote(part.toolCallId)}`,
    `Tool: ${quote(part.toolName)}`,
    `Input: ${serializeJson(part.input, 'tool-call input')}`,
    `Provider executed: ${part.providerExecuted === true ? 'true' : 'false'}`,
  ].join('\n');
}

function formatToolResult(part: LanguageModelV4ToolResultPart): string {
  return [
    '[Zero historical tool result; inactive for this request]',
    `Call ID: ${quote(part.toolCallId)}`,
    `Tool: ${quote(part.toolName)}`,
    `Output: ${formatToolOutput(part.output)}`,
  ].join('\n');
}

function formatToolApproval(part: {
  approvalId: string;
  approved: boolean;
  reason?: string;
}): string {
  return [
    '[Zero historical tool approval; inactive for this request]',
    `Approval ID: ${quote(part.approvalId)}`,
    `Approved: ${part.approved ? 'true' : 'false'}`,
    ...(part.reason === undefined ? [] : [`Reason: ${quote(part.reason)}`]),
  ].join('\n');
}

function formatToolOutput(output: LanguageModelV4ToolResultOutput): string {
  switch (output.type) {
    case 'text':
      return `text ${quote(output.value)}`;
    case 'json':
      return `json ${serializeJson(output.value, 'tool-result JSON')}`;
    case 'execution-denied':
      return output.reason === undefined
        ? 'execution denied'
        : `execution denied ${quote(output.reason)}`;
    case 'error-text':
      return `text error ${quote(output.value)}`;
    case 'error-json':
      return `JSON error ${serializeJson(output.value, 'tool-result error JSON')}`;
    case 'content':
      return formatContentOutput(output.value);
  }
}

function formatContentOutput(
  value: Extract<LanguageModelV4ToolResultOutput, { type: 'content' }>['value'],
): string {
  const projected = value.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'file' && part.data.type === 'text') {
      return {
        type: 'inline-text-file',
        mediaType: part.mediaType,
        ...(part.filename === undefined ? {} : { filename: part.filename }),
        text: part.data.text,
      };
    }
    throw invalidHistoryError(
      `${part.type === 'file' ? 'non-text file' : 'custom'} tool-result content cannot be projected safely`,
    );
  });
  return `content ${serializeJson(projected, 'tool-result content')}`;
}

function serializeJson(value: unknown, field: string): string {
  try {
    assertJsonValue(value, new Set(), 0);
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError('undefined JSON serialization');
    return serialized;
  } catch {
    throw invalidHistoryError(`${field} is not safely JSON-serializable`);
  }
}

function assertJsonValue(value: unknown, ancestors: Set<object>, depth: number): void {
  if (depth > 64) throw new TypeError('JSON nesting limit exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite JSON number');
    return;
  }
  if (typeof value !== 'object') throw new TypeError('non-JSON value');
  if (ancestors.has(value)) throw new TypeError('cyclic JSON value');

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('non-plain JSON object');
  }

  ancestors.add(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    assertJsonValue(entry, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function textPart(text: string) {
  return { type: 'text' as const, text };
}

function invalidHistoryError(reason: string): AIError {
  return new AIError(
    `Amazon Bedrock could not preserve inactive historical tool context: ${reason}.`,
    'AI_REQUEST_INVALID',
    400,
  );
}

class SynthesizedTextBudget {
  private bytes = 0;
  private readonly encoder = new TextEncoder();

  constructor(private readonly maximum: number) {}

  capture(value: string): string {
    this.bytes += this.encoder.encode(value).byteLength;
    if (this.bytes > this.maximum) {
      throw invalidHistoryError(`projected history exceeds ${this.maximum} UTF-8 bytes`);
    }
    return value;
  }
}
