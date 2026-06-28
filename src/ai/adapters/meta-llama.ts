/**
 * meta-llama.ts
 *
 * AI SDK provider adapter for Meta's hosted Llama API. This file owns the
 * native Meta request/response mapping only; it does not manage Zero config,
 * aliases, observability, persistence, or HTTP routes.
 */

import { Buffer } from 'node:buffer';

import {
  type LanguageModelV2,
  type LanguageModelV2CallOptions,
  type LanguageModelV2CallWarning,
  type LanguageModelV2Content,
  type LanguageModelV2FinishReason,
  type LanguageModelV2FunctionTool,
  type LanguageModelV2StreamPart,
  type LanguageModelV2ToolCall,
  type LanguageModelV2Usage,
} from '@ai-sdk/provider';
import {
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  generateId,
  loadApiKey,
  postJsonToApi,
  withoutTrailingSlash,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';

/** Callable provider factory returned by `createMetaLlama()`. */
export interface MetaLlamaProvider {
  (modelId: string, settings?: MetaLlamaSettings): LanguageModelV2;
  languageModel(modelId: string, settings?: MetaLlamaSettings): LanguageModelV2;
}

/** Per-model defaults accepted by the Meta Llama adapter. */
export interface MetaLlamaSettings {
  temperature?: number;
  topP?: number;
  topK?: number;
  repetitionPenalty?: number;
  maxTokens?: number;
  user?: string;
}

/** Provider-level settings for the Meta Llama hosted API adapter. */
export interface MetaLlamaProviderSettings {
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  generateId?: () => string;
}

interface MetaLlamaConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  generateId: () => string;
}

/**
 * Create a Meta Llama AI SDK provider.
 *
 * The adapter uses `LLAMA_API_KEY` when `apiKey` is omitted, matching Meta's
 * official hosted Llama API environment convention.
 */
export function createMetaLlama(options: MetaLlamaProviderSettings = {}): MetaLlamaProvider {
  const createLanguageModel = (
    modelId: string,
    settings: MetaLlamaSettings = {}
  ) =>
    new MetaLlamaLanguageModel(modelId, settings, {
      provider: 'meta-llama',
      baseURL: withoutTrailingSlash(options.baseURL) ?? 'https://api.llama.com/v1',
      headers: () => ({
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'LLAMA_API_KEY',
          description: 'Meta Llama',
        })}`,
        'Content-Type': 'application/json',
        ...options.headers,
      }),
      generateId: options.generateId ?? generateId,
    });

  const provider = function createMetaLlamaModel(modelId: string, settings?: MetaLlamaSettings) {
    if (new.target) {
      throw new Error('The Meta Llama model factory cannot be called with the new keyword.');
    }
    return createLanguageModel(modelId, settings);
  };

  provider.languageModel = createLanguageModel;

  return provider as MetaLlamaProvider;
}

/** Default Meta Llama provider that reads `LLAMA_API_KEY` at call time. */
export const metaLlama = createMetaLlama();

class MetaLlamaLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly provider: string;
  readonly modelId: string;
  readonly defaultSettings: MetaLlamaSettings;
  readonly supportedUrls = {
    'image/*': [/^https?:\/\/.+$/, /^data:image\//],
  };

  private readonly config: MetaLlamaConfig;

  constructor(modelId: string, settings: MetaLlamaSettings, config: MetaLlamaConfig) {
    this.provider = config.provider;
    this.modelId = modelId;
    this.defaultSettings = settings;
    this.config = config;
  }

  private async getArgs(options: LanguageModelV2CallOptions) {
    const warnings: LanguageModelV2CallWarning[] = [];

    const messages = options.prompt
      .map((message) => {
        switch (message.role) {
          case 'system':
            return { role: 'system', content: message.content };
          case 'user':
            if (typeof message.content === 'string') {
              return { role: 'user', content: message.content };
            }
            return {
              role: 'user',
              content: message.content.map((part) => {
                if (part.type === 'text') {
                  return { type: 'text', text: part.text };
                }
                if (part.type === 'file' && part.mediaType?.startsWith('image/')) {
                  if (part.data instanceof URL) {
                    return { type: 'image_url', image_url: { url: part.data.toString() } };
                  }
                  const base64 =
                    typeof part.data === 'string'
                      ? part.data
                      : Buffer.from(part.data).toString('base64');
                  return {
                    type: 'image_url',
                    image_url: { url: `data:${part.mediaType};base64,${base64}` },
                  };
                }
                return part;
              }),
            };
          case 'assistant': {
            const assistantMsg: {
              role: 'assistant';
              content?: string;
              tool_calls?: unknown[];
            } = { role: 'assistant' };
            const textParts: string[] = [];
            const toolCalls: unknown[] = [];

            for (const part of message.content) {
              if (part.type === 'text') {
                textParts.push(part.text);
              } else if (part.type === 'tool-call') {
                toolCalls.push({
                  id: part.toolCallId,
                  type: 'function',
                  function: {
                    name: part.toolName,
                    arguments:
                      typeof part.input === 'string' ? part.input : JSON.stringify(part.input),
                  },
                });
              }
            }

            if (textParts.length > 0) {
              assistantMsg.content = textParts.join('');
            }
            if (toolCalls.length > 0) {
              assistantMsg.tool_calls = toolCalls;
            }
            return assistantMsg;
          }
          case 'tool': {
            const toolResult = message.content[0];
            let content: string;

            if (typeof toolResult.output === 'string') {
              content = toolResult.output;
            } else if (toolResult.output && typeof toolResult.output === 'object') {
              const outputObj = toolResult.output as { type?: unknown; value?: unknown };
              if (outputObj.type === 'text') {
                content = typeof outputObj.value === 'string' ? outputObj.value : '';
              } else {
                content = JSON.stringify(toolResult.output);
              }
            } else {
              content = JSON.stringify(toolResult.output);
            }

            return {
              role: 'tool',
              tool_call_id: toolResult.toolCallId,
              content,
            };
          }
          default:
            warnings.push({
              type: 'other',
              message: `Role ${(message as { role?: string }).role} is not supported`,
            });
            return null;
        }
      })
      .filter(Boolean);

    const body: Record<string, unknown> = {
      model: this.modelId,
      messages,
      temperature: options.temperature ?? this.defaultSettings.temperature ?? 0.6,
      top_p: options.topP ?? this.defaultSettings.topP ?? 0.9,
      max_completion_tokens: options.maxOutputTokens ?? this.defaultSettings.maxTokens ?? 4096,
      repetition_penalty: this.defaultSettings.repetitionPenalty ?? 1.0,
      user: this.defaultSettings.user,
    };

    if (options.topK ?? this.defaultSettings.topK) {
      body.top_k = options.topK ?? this.defaultSettings.topK;
    }

    if (options.stopSequences) {
      body.stop = options.stopSequences;
    }

    if (options.tools) {
      body.tools = options.tools.map((tool) => {
        if (tool.type === 'function') {
          const funcTool = tool as LanguageModelV2FunctionTool;
          return {
            type: 'function',
            function: {
              name: funcTool.name,
              description: funcTool.description,
              parameters: funcTool.inputSchema,
            },
          };
        }
        return tool;
      });

      if (options.toolChoice) {
        if (typeof options.toolChoice === 'string') {
          body.tool_choice = options.toolChoice;
        } else if (options.toolChoice.type === 'tool') {
          body.tool_choice = {
            type: 'function',
            function: { name: options.toolChoice.toolName },
          };
        }
      }
    }

    if (options.responseFormat) {
      if (options.responseFormat.type === 'json') {
        body.response_format = {
          type: 'json_schema',
          json_schema: options.responseFormat.schema,
        };
      } else {
        body.response_format = options.responseFormat;
      }
    }

    return { args: body, warnings };
  }

  async doGenerate(options: LanguageModelV2CallOptions): Promise<{
    content: LanguageModelV2Content[];
    finishReason: LanguageModelV2FinishReason;
    usage: LanguageModelV2Usage;
    warnings: LanguageModelV2CallWarning[];
    request?: { body: unknown };
    response?: { body: unknown };
  }> {
    const { args, warnings } = await this.getArgs(options);

    const { value: response } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: this.config.headers(),
      body: { ...args, stream: false },
      abortSignal: options.abortSignal,
      failedResponseHandler: createJsonErrorResponseHandler({
        errorSchema: z
          .object({
            error: z
              .object({
                message: z.string(),
                type: z.string().optional(),
                code: z.string().optional(),
              })
              .optional(),
            message: z.string().optional(),
          })
          .passthrough(),
        errorToMessage: (error) =>
          error?.error?.message || error?.message || 'Unknown error',
        isRetryable: (response) => response.status >= 500,
      }),
      successfulResponseHandler: createJsonResponseHandler(z.any()),
    });

    const responseData = response as Record<string, any>;
    const content: LanguageModelV2Content[] = [];
    const message = responseData.completion_message || responseData.choices?.[0]?.message;

    if (message?.content) {
      let textContent = '';
      if (typeof message.content === 'string') {
        textContent = message.content;
      } else if (message.content?.type === 'text' && message.content?.text) {
        textContent = message.content.text;
      } else if (Array.isArray(message.content)) {
        textContent = message.content.map((c: { text?: string }) => c.text || '').join('');
      }
      if (textContent) {
        content.push({ type: 'text', text: textContent });
      }
    }

    if (message?.tool_calls) {
      for (const toolCall of message.tool_calls) {
        const tc: LanguageModelV2ToolCall = {
          type: 'tool-call',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input:
            typeof toolCall.function.arguments === 'string'
              ? toolCall.function.arguments
              : JSON.stringify(toolCall.function.arguments),
        };
        content.push(tc);
      }
    }

    const usage = extractUsage(responseData);

    return {
      content,
      finishReason: this.mapFinishReason(
        message?.stop_reason || responseData.choices?.[0]?.finish_reason || 'stop'
      ),
      usage,
      request: { body: args },
      response: { body: response },
      warnings,
    };
  }

  async doStream(options: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>;
    warnings: LanguageModelV2CallWarning[];
  }> {
    const { args, warnings } = await this.getArgs(options);

    const response = await fetch(`${this.config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: this.config.headers(),
      body: JSON.stringify({ ...args, stream: true }),
      signal: options.abortSignal,
    });

    if (!response.ok) {
      let message = `HTTP error! status: ${response.status}`;
      try {
        const data = await response.json() as { error?: { message?: string }; message?: string };
        message = data?.error?.message || data?.message || message;
      } catch {
        // Invalid error bodies still produce a useful status error.
      }
      throw new Error(message);
    }

    const stream = response.body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(this.createSSEParser())
      .pipeThrough(this.createStreamTransformer(warnings));

    return { stream, warnings };
  }

  private createSSEParser(): TransformStream<string, { type: 'done' } | { type: 'data'; data: any }> {
    let buffer = '';
    let dataLines: string[] = [];

    const flushEvent = (controller: TransformStreamDefaultController<{ type: 'done' } | { type: 'data'; data: any }>) => {
      if (dataLines.length === 0) return;
      const data = dataLines.join('\n');
      dataLines = [];
      if (data === '[DONE]') {
        controller.enqueue({ type: 'done' });
        return;
      }
      try {
        controller.enqueue({ type: 'data', data: JSON.parse(data) });
      } catch {
        // Providers can emit comments or malformed keep-alive frames.
      }
    };

    return new TransformStream({
      transform(chunk, controller) {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
            continue;
          }
          if (line.trim() === '') {
            flushEvent(controller);
          }
        }
      },
      flush(controller) {
        flushEvent(controller);
      },
    });
  }

  private createStreamTransformer(
    warnings: LanguageModelV2CallWarning[]
  ): TransformStream<{ type: 'done' } | { type: 'data'; data: any }, LanguageModelV2StreamPart> {
    let isFirstChunk = true;
    const toolCalls = new Map<string, { id: string; name: string; args: string }>();

    return new TransformStream({
      transform(chunk, controller) {
        if (isFirstChunk) {
          controller.enqueue({ type: 'stream-start', warnings });
          isFirstChunk = false;
        }

        if (chunk.type === 'done') return;
        const data = chunk.data;

        if (data.event?.event_type === 'progress') {
          const delta = data.event.delta;
          if (delta?.type === 'text' && delta.text) {
            controller.enqueue({ type: 'text-delta', id: 'text-0', delta: delta.text });
          }
          if (delta?.type === 'tool_call') {
            const id = delta.id || 'tool_0';
            if (!toolCalls.has(id)) {
              toolCalls.set(id, { id, name: '', args: '' });
            }
            const tc = toolCalls.get(id)!;
            if (delta.function?.name) tc.name = delta.function.name;
            if (delta.function?.arguments) {
              tc.args += delta.function.arguments;
              controller.enqueue({
                type: 'tool-input-delta',
                id,
                delta: delta.function.arguments,
              });
            }
          }
        }

        if (data.choices?.[0]) {
          const choice = data.choices[0];
          if (choice.delta?.content) {
            controller.enqueue({ type: 'text-delta', id: 'text-0', delta: choice.delta.content });
          }
          if (choice.delta?.tool_calls) {
            for (const toolCall of choice.delta.tool_calls) {
              const id = toolCall.id || `tool_${toolCall.index}`;
              if (!toolCalls.has(id)) {
                toolCalls.set(id, { id, name: '', args: '' });
              }
              const tc = toolCalls.get(id)!;
              if (toolCall.function?.name) tc.name = toolCall.function.name;
              if (toolCall.function?.arguments) {
                tc.args += toolCall.function.arguments;
                controller.enqueue({
                  type: 'tool-input-delta',
                  id,
                  delta: toolCall.function.arguments,
                });
              }
            }
          }

          if (choice.finish_reason) {
            enqueueToolCalls(controller, toolCalls);
            controller.enqueue({
              type: 'finish',
              finishReason: mapFinishReason(choice.finish_reason),
              usage: data.usage ? usageFromOpenAIUsage(data.usage) : emptyUsage(),
            });
          }
        }

        if (data.event?.event_type === 'complete') {
          enqueueToolCalls(controller, toolCalls);
          controller.enqueue({
            type: 'finish',
            finishReason: mapFinishReason(data.event.stop_reason),
            usage: data.event.metrics ? usageFromMetrics(data.event.metrics) : emptyUsage(),
          });
        }
      },
    });
  }

  private mapFinishReason(reason: string): LanguageModelV2FinishReason {
    return mapFinishReason(reason);
  }
}

function enqueueToolCalls(
  controller: TransformStreamDefaultController<LanguageModelV2StreamPart>,
  toolCalls: Map<string, { id: string; name: string; args: string }>
): void {
  for (const [id, tc] of toolCalls) {
    if (tc.args) {
      const toolCallContent: LanguageModelV2ToolCall = {
        type: 'tool-call',
        toolCallId: id,
        toolName: tc.name,
        input: tc.args,
      };
      controller.enqueue(toolCallContent);
    }
  }
}

function extractUsage(responseData: Record<string, any>): LanguageModelV2Usage {
  if (responseData.usage) return usageFromOpenAIUsage(responseData.usage);
  if (responseData.metrics) return usageFromMetrics(responseData.metrics);
  return emptyUsage();
}

function usageFromOpenAIUsage(usage: Record<string, any>): LanguageModelV2Usage {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function usageFromMetrics(metrics: Array<{ metric: string; value: number }>): LanguageModelV2Usage {
  return {
    inputTokens: findMetric(metrics, 'num_prompt_tokens') ?? findMetric(metrics, 'prompt_tokens'),
    outputTokens: findMetric(metrics, 'num_completion_tokens') ?? findMetric(metrics, 'completion_tokens'),
    totalTokens: findMetric(metrics, 'num_total_tokens') ?? findMetric(metrics, 'total_tokens'),
  };
}

function findMetric(metrics: Array<{ metric: string; value: number }>, metric: string): number | undefined {
  return metrics.find((item) => item.metric === metric)?.value;
}

function emptyUsage(): LanguageModelV2Usage {
  return {
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
  };
}

function mapFinishReason(reason: string | undefined): LanguageModelV2FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
    case 'tool-calls':
      return 'tool-calls';
    case 'length':
      return 'length';
    case 'content_filter':
    case 'content-filter':
      return 'content-filter';
    default:
      return 'other';
  }
}
