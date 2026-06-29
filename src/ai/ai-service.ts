/**
 * ai-service.ts
 *
 * Framework-neutral AI gateway for Zero app code. This file owns provider
 * model resolution and AI SDK call orchestration; it does not register routes,
 * read request context, or persist conversation history.
 */

import {
  embed,
  generateImage,
  generateText,
  streamText,
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
  type ToolSet,
} from 'ai';

import { AIConversationBuilder, toModelMessages } from './ai-conversation';
import { AIConversationSessionBuilder } from './ai-session';
import { AIError } from './ai-errors';
import {
  createAIRegistry,
  getAIProviderStatuses,
  isAIModelActive,
  resolveEmbeddingModel,
  resolveImageModel,
  resolveLanguageModel,
  resolveSpeechModel,
  resolveTranscriptionModel,
  type AIRegistry,
} from './ai-registry';
import {
  emitAIRequestCompleted,
  emitAIRequestFailed,
  emitAIRequestStarted,
} from './ai-observability';
import type {
  AIConversation,
  AIConversationOptions,
  AIConversationSession,
  AIConversationSessionOptions,
  AIEmbedRequest,
  AIEmbedResult,
  AIGenerateConversationRequest,
  AIGenerateImageRequest,
  AIGenerateSpeechRequest,
  AIGenerateTextRequest,
  AIImageResult,
  AISpeechResult,
  AIStatus,
  AIStreamResult,
  AITextResult,
  AITranscribeRequest,
  AITranscriptionResult,
  ResolvedAIProviderConfig,
  ResolvedAIConfig,
} from './ai-types';

/** Internal AI runtime service created by the AI plugin or directly in tests. */
export class AIService {
  private readonly registry: AIRegistry;

  /** Create an AI service from fully resolved AI config. */
  constructor(private readonly config: ResolvedAIConfig) {
    this.registry = createAIRegistry(config);
  }

  /** Return public-safe status for configured providers and aliases. */
  status(): AIStatus {
    const aliases: AIStatus['aliases'] = {};
    for (const [alias, model] of Object.entries(this.config.aliases)) {
      const state = isAIModelActive(this.registry, this.config.aliases, alias, capabilityForAlias(alias));
      aliases[alias] = {
        model,
        active: state.active,
        reason: state.reason,
      };
    }

    return {
      enabled: true,
      providers: getAIProviderStatuses(this.config, this.registry),
      aliases,
    };
  }

  /** Canonical getStatus alias for status(). */
  getStatus(): AIStatus {
    return this.status();
  }

  /** Create a chainable conversation builder for multi-turn model calls. */
  conversation(options: AIConversationOptions = {}): AIConversation {
    return new AIConversationBuilder(this, options);
  }

  /** Create a bounded, non-persistent session that appends user/assistant turns. */
  session(options: AIConversationSessionOptions = {}): AIConversationSession {
    return new AIConversationSessionBuilder(this, options);
  }

  /** Generate text from either a simple prompt or a normalized message list. */
  async generateText(request: AIGenerateTextRequest): Promise<AITextResult> {
    const resolved = resolveLanguageModel(this.registry, this.config.aliases, request.model, 'smart');
    assertLanguageRequestCapabilities(resolved.provider, request);
    const startedAt = Date.now();
    emitAIRequestStarted({
      providerId: resolved.provider.id,
      providerType: resolved.provider.type,
      requestedModel: resolved.reference.requested,
      model: resolved.reference.resolved,
      capability: 'text',
      metadata: request.metadata,
    });

    try {
      const result = await generateText({
        model: resolved.model,
        ...promptInput(request),
        system: request.system,
        temperature: request.temperature,
        topP: request.topP,
        maxOutputTokens: request.maxOutputTokens,
        stopSequences: request.stopSequences,
        abortSignal: request.abortSignal,
        providerOptions: request.providerOptions as any,
        ...(request.tools ? { tools: request.tools } : {}),
        ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
      });
      emitAIRequestCompleted({
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'text',
        durationMs: Date.now() - startedAt,
        ...usageMetadata(result.usage),
        toolNames: Object.keys(request.tools ?? {}),
        metadata: request.metadata,
      });
      return result as AITextResult;
    } catch (error) {
      emitAIRequestFailed(error, {
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'text',
        durationMs: Date.now() - startedAt,
        metadata: request.metadata,
      });
      throw normalizeAIRequestError(error);
    }
  }

  /** Stream text from either a simple prompt or a normalized message list. */
  streamText(request: AIGenerateTextRequest): AIStreamResult {
    const resolved = resolveLanguageModel(this.registry, this.config.aliases, request.model, 'smart');
    assertLanguageRequestCapabilities(resolved.provider, request);
    const startedAt = Date.now();
    emitAIRequestStarted({
      providerId: resolved.provider.id,
      providerType: resolved.provider.type,
      requestedModel: resolved.reference.requested,
      model: resolved.reference.resolved,
      capability: 'streaming',
      metadata: request.metadata,
    });

    try {
      return streamText({
        model: resolved.model,
        ...promptInput(request),
        system: request.system,
        temperature: request.temperature,
        topP: request.topP,
        maxOutputTokens: request.maxOutputTokens,
        stopSequences: request.stopSequences,
        abortSignal: request.abortSignal,
        providerOptions: request.providerOptions as any,
        ...(request.tools ? { tools: request.tools } : {}),
        ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
        onFinish: ({ usage }) => {
          emitAIRequestCompleted({
            providerId: resolved.provider.id,
            providerType: resolved.provider.type,
            requestedModel: resolved.reference.requested,
            model: resolved.reference.resolved,
            capability: 'streaming',
            durationMs: Date.now() - startedAt,
            ...usageMetadata(usage),
            toolNames: Object.keys(request.tools ?? {}),
            metadata: request.metadata,
          });
        },
        onError: ({ error }) => {
          emitAIRequestFailed(error, {
            providerId: resolved.provider.id,
            providerType: resolved.provider.type,
            requestedModel: resolved.reference.requested,
            model: resolved.reference.resolved,
            capability: 'streaming',
            durationMs: Date.now() - startedAt,
            metadata: request.metadata,
          });
        },
      }) as AIStreamResult;
    } catch (error) {
      emitAIRequestFailed(error, {
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'streaming',
        durationMs: Date.now() - startedAt,
        metadata: request.metadata,
      });
      throw normalizeAIRequestError(error);
    }
  }

  /** Generate text from an explicit conversation message list. */
  generateConversation(request: AIGenerateConversationRequest): Promise<AITextResult> {
    return this.generateText({
      ...request,
      messages: request.messages,
    });
  }

  /** Stream text from an explicit conversation message list. */
  streamConversation(request: AIGenerateConversationRequest): AIStreamResult {
    return this.streamText({
      ...request,
      messages: request.messages,
    });
  }

  /** Generate one embedding vector for a string. */
  async embed(request: AIEmbedRequest): Promise<AIEmbedResult> {
    const resolved = resolveEmbeddingModel(this.registry, this.config.aliases, request.model, 'embedding');
    const startedAt = Date.now();
    emitAIRequestStarted({
      providerId: resolved.provider.id,
      providerType: resolved.provider.type,
      requestedModel: resolved.reference.requested,
      model: resolved.reference.resolved,
      capability: 'embeddings',
      metadata: request.metadata,
    });

    try {
      const result = await embed({
        model: resolved.model,
        value: request.value,
        abortSignal: request.abortSignal,
        providerOptions: request.providerOptions as any,
      });
      emitAIRequestCompleted({
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'embeddings',
        durationMs: Date.now() - startedAt,
        totalTokens: result.usage?.tokens,
        metadata: request.metadata,
      });
      return {
        embedding: result.embedding,
        value: result.value,
        usage: result.usage,
      };
    } catch (error) {
      emitAIRequestFailed(error, {
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'embeddings',
        durationMs: Date.now() - startedAt,
        metadata: request.metadata,
      });
      throw normalizeAIRequestError(error);
    }
  }

  /** Generate images through a configured image-capable provider. */
  async generateImage(request: AIGenerateImageRequest): Promise<AIImageResult> {
    const resolved = resolveImageModel(this.registry, this.config.aliases, request.model, 'image');
    const startedAt = Date.now();
    emitAIRequestStarted({
      providerId: resolved.provider.id,
      providerType: resolved.provider.type,
      requestedModel: resolved.reference.requested,
      model: resolved.reference.resolved,
      capability: 'images',
      metadata: request.metadata,
    });

    try {
      const result = await generateImage({
        model: resolved.model,
        prompt: request.prompt,
        n: request.n,
        size: request.size,
        aspectRatio: request.aspectRatio,
        seed: request.seed,
        abortSignal: request.abortSignal,
        providerOptions: request.providerOptions as any,
      });
      emitAIRequestCompleted({
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'images',
        durationMs: Date.now() - startedAt,
        ...usageMetadata(result.usage),
        metadata: request.metadata,
      });
      return result;
    } catch (error) {
      emitAIRequestFailed(error, {
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'images',
        durationMs: Date.now() - startedAt,
        metadata: request.metadata,
      });
      throw normalizeAIRequestError(error);
    }
  }

  /** Transcribe audio through a configured transcription-capable provider. */
  async transcribe(request: AITranscribeRequest): Promise<AITranscriptionResult> {
    const resolved = resolveTranscriptionModel(this.registry, this.config.aliases, request.model, 'transcription');
    const startedAt = Date.now();
    emitAIRequestStarted({
      providerId: resolved.provider.id,
      providerType: resolved.provider.type,
      requestedModel: resolved.reference.requested,
      model: resolved.reference.resolved,
      capability: 'transcription',
      metadata: request.metadata,
    });

    try {
      const result = await transcribe({
        model: resolved.model,
        audio: request.audio as any,
        abortSignal: request.abortSignal,
        providerOptions: request.providerOptions as any,
      });
      emitAIRequestCompleted({
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'transcription',
        durationMs: Date.now() - startedAt,
        metadata: request.metadata,
      });
      return result;
    } catch (error) {
      emitAIRequestFailed(error, {
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'transcription',
        durationMs: Date.now() - startedAt,
        metadata: request.metadata,
      });
      throw normalizeAIRequestError(error);
    }
  }

  /** Generate speech audio through a configured speech-capable provider. */
  async generateSpeech(request: AIGenerateSpeechRequest): Promise<AISpeechResult> {
    const resolved = resolveSpeechModel(this.registry, this.config.aliases, request.model, 'speech');
    const startedAt = Date.now();
    emitAIRequestStarted({
      providerId: resolved.provider.id,
      providerType: resolved.provider.type,
      requestedModel: resolved.reference.requested,
      model: resolved.reference.resolved,
      capability: 'speech',
      metadata: request.metadata,
    });

    try {
      const result = await generateSpeech({
        model: resolved.model,
        text: request.text,
        voice: request.voice,
        outputFormat: request.outputFormat,
        instructions: request.instructions,
        speed: request.speed,
        language: request.language,
        maxRetries: request.maxRetries,
        abortSignal: request.abortSignal,
        providerOptions: request.providerOptions as any,
      });
      emitAIRequestCompleted({
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'speech',
        durationMs: Date.now() - startedAt,
        metadata: request.metadata,
      });
      return result;
    } catch (error) {
      emitAIRequestFailed(error, {
        providerId: resolved.provider.id,
        providerType: resolved.provider.type,
        requestedModel: resolved.reference.requested,
        model: resolved.reference.resolved,
        capability: 'speech',
        durationMs: Date.now() - startedAt,
        metadata: request.metadata,
      });
      throw normalizeAIRequestError(error);
    }
  }
}

function promptInput(request: Pick<AIGenerateTextRequest, 'prompt' | 'messages'>):
  | { prompt: string; messages?: undefined }
  | { messages: ReturnType<typeof toModelMessages>; prompt?: undefined } {
  if (request.messages) {
    return { messages: toModelMessages(request.messages) };
  }
  return { prompt: request.prompt ?? '' };
}

function assertLanguageRequestCapabilities(
  provider: ResolvedAIProviderConfig,
  request: Pick<AIGenerateTextRequest, 'messages' | 'tools'>
): void {
  if (request.tools && Object.keys(request.tools).length > 0 && !provider.capabilities.tools) {
    throw new AIError(
      `AI provider "${provider.id}" does not support tools.`,
      'AI_CAPABILITY_NOT_SUPPORTED',
      400
    );
  }

  if (messagesRequireVision(request.messages) && !provider.capabilities.vision) {
    throw new AIError(
      `AI provider "${provider.id}" does not support vision inputs.`,
      'AI_CAPABILITY_NOT_SUPPORTED',
      400
    );
  }
}

function messagesRequireVision(messages: readonly AIGenerateConversationRequest['messages'][number][] | undefined): boolean {
  if (!messages) return false;

  return messages.some((message) => {
    if (typeof message.content === 'string') return false;

    return message.content.some((part) => {
      if (part.type === 'image') return true;
      return part.type === 'file' && part.mediaType.startsWith('image/');
    });
  });
}

function usageMetadata(usage: AIUsageLike | undefined): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} {
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
  };
}

function capabilityForAlias(alias: string): Parameters<typeof isAIModelActive>[3] {
  switch (alias) {
    case 'embedding':
      return 'embeddings';
    case 'image':
      return 'images';
    case 'transcription':
      return 'transcription';
    case 'speech':
      return 'speech';
    default:
      return 'text';
  }
}

interface AIUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

function normalizeAIRequestError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  return new AIError(
    error instanceof Error ? error.message : 'AI request failed.',
    'AI_REQUEST_FAILED',
    500
  );
}
