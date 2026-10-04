/**
 * ai-service.ts
 *
 * Framework-neutral AI gateway for Zero app code. This file owns provider
 * model resolution and AI SDK call orchestration; it does not register routes,
 * read request context, or persist conversation history.
 */

import type { ToolSet } from 'ai';
import type { Context } from '@ai-sdk/provider-utils';

import type { WorkflowRegistry } from '../workflows/workflow-registry';
import { AIConversationBuilder } from './ai-conversation';
import { AIConversationSessionBuilder } from './ai-session';
import { AIAgentService, type AIAgentServiceOptions } from './agents';
import type {
  AIDurableAgentRuntimeOptions,
  AIDurableAgentWorkflowRuntime,
} from './durable';
import { executeAIEmbed, executeAIEmbedMany } from './ai-embedding-operations';
import type { AIEmbedManyRequest, AIEmbedManyResult } from './ai-embedding-types';
import {
  createAIHostedFilesService,
  type AIHostedFilesService,
} from './ai-files-service';
import { executeAIRerank } from './ai-rerank-service';
import type {
  AIRerankDocument,
  AIRerankRequest,
  AIRerankResult,
} from './ai-rerank-types';
import {
  createAIRegistry,
  getAIFilesProviderStatus,
  getAIProviderStatuses,
  isAIModelActive,
  resolveEmbeddingModel,
  resolveImageModel,
  resolveLanguageModel,
  resolveRerankingModel,
  resolveSpeechModel,
  resolveTranscriptionModel,
  type AIRegistry,
} from './ai-registry';
import { startAIRequestTelemetry } from './ai-request-telemetry';
import {
  capabilityForAlias,
} from './ai-service-support';
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
  AIStreamConversationRequest,
  AIStreamResult,
  AIStreamTextRequest,
  AITextResult,
  AITranscribeRequest,
  AITranscriptionResult,
  ResolvedAIConfig,
} from './ai-types';
import type { AIAnyOutput, AIOutputSpec } from './ai-output';
import { createAIVideoService, type AIVideoService } from './ai-video-service';
import type { AIEmitCode } from './ai-observability';
import { createAIModelExecutionPreparer } from './ai-model-execution';
import { executeAIGenerateImage } from './ai-image-operations';
import { executeAISpeech, executeAITranscription } from './ai-audio-operations';
import { executeAIGenerateText, executeAIStreamText } from './ai-text-operations';

/** Optional process-local dependencies for a standalone or managed AI service. */
export interface AIServiceOptions {
  /** Managed apps bind this to their own observability runtime. */
  readonly emitCode?: AIEmitCode;
}

/** Internal AI runtime service created by the AI plugin or directly in tests. */
export class AIService {
  private readonly registry: AIRegistry;
  private readonly emitCode: AIEmitCode | undefined;
  /** Provider-hosted file operations bound to this service's configured registry. */
  readonly files: AIHostedFilesService;
  /** Preview video operations with bounded materialization and durable job locators. */
  readonly video: AIVideoService;

  /** Create an AI service from fully resolved AI config. */
  constructor(private readonly config: ResolvedAIConfig, options: AIServiceOptions = {}) {
    this.emitCode = options.emitCode;
    this.registry = createAIRegistry(config, options.emitCode);
    this.files = createAIHostedFilesService({
      registry: this.registry,
      defaultProvider: config.filesProvider,
    });
    this.video = createAIVideoService({
      registry: this.registry,
      aliases: config.aliases,
    });
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
      filesProvider: getAIFilesProviderStatus(this.config, this.registry),
    };
  }

  /** Canonical getStatus alias for status(). */
  getStatus(): AIStatus {
    return this.status();
  }

  /** Create an isolated agent registry/runner that resolves models through this AI service. */
  createAgentService(
    options: Omit<AIAgentServiceOptions, 'prepareModelExecution' | 'resolveModel'> = {}
  ): AIAgentService {
    return new AIAgentService({
      ...options,
      emitCode: options.emitCode ?? this.emitCode,
      prepareModelExecution: createAIModelExecutionPreparer({
        emitCode: options.emitCode ?? this.emitCode,
        resolveModel: (reference) => resolveLanguageModel(
          this.registry,
          this.config.aliases,
          reference,
          'smart',
        ),
      }),
      resolveModel: (reference) => resolveLanguageModel(
        this.registry,
        this.config.aliases,
        reference,
        'smart'
      ).model,
    });
  }

  /** Create a Torrent-backed agent runtime using this app's model aliases and providers. */
  async createDurableAgentRuntime<EXECUTION_CONTEXT = undefined, TServices = unknown>(
    registry: WorkflowRegistry,
    options: Omit<
      AIDurableAgentRuntimeOptions<EXECUTION_CONTEXT, TServices>,
      'prepareModelExecution' | 'resolveModel'
    >,
  ): Promise<AIDurableAgentWorkflowRuntime<EXECUTION_CONTEXT, TServices>> {
    // Keep Torrent out of the base AIService module graph until an app opts in.
    // This avoids coupling ordinary AI/plugin startup to workflow internals.
    const { AIDurableAgentWorkflowRuntime } = await import(
      './durable/ai-durable-agent-workflow'
    );
    return new AIDurableAgentWorkflowRuntime(registry, {
      ...options,
      emitCode: options.emitCode ?? this.emitCode,
      prepareModelExecution: createAIModelExecutionPreparer({
        emitCode: options.emitCode ?? this.emitCode,
        resolveModel: (reference) => resolveLanguageModel(
          this.registry,
          this.config.aliases,
          reference,
          'smart',
        ),
      }),
    });
  }

  /** Create a chainable conversation builder for multi-turn model calls. */
  conversation<
    Tools extends ToolSet = ToolSet,
    RuntimeContext extends Context = Context,
  >(options: AIConversationOptions<Tools, RuntimeContext> = {}): AIConversation<Tools, RuntimeContext> {
    return new AIConversationBuilder<Tools, RuntimeContext>(this, options);
  }

  /** Create a bounded, non-persistent session that appends user/assistant turns. */
  session<
    Tools extends ToolSet = ToolSet,
    RuntimeContext extends Context = Context,
  >(options: AIConversationSessionOptions<Tools, RuntimeContext> = {}):
    AIConversationSession<Tools, RuntimeContext> {
    return new AIConversationSessionBuilder<Tools, RuntimeContext>(this, options);
  }

  /** Generate text from either a simple prompt or a normalized message list. */
  async generateText<
    Tools extends ToolSet = ToolSet,
    RuntimeContext extends Context = Context,
    Output extends AIOutputSpec = AIAnyOutput,
  >(request: AIGenerateTextRequest<Tools, RuntimeContext, Output>):
    Promise<AITextResult<Tools, RuntimeContext, Output>> {
    const resolved = resolveLanguageModel(this.registry, this.config.aliases, request.model, 'smart');
    return executeAIGenerateText(request, { resolved, emitCode: this.emitCode });
  }

  /** Stream text from either a simple prompt or a normalized message list. */
  streamText<
    Tools extends ToolSet = ToolSet,
    RuntimeContext extends Context = Context,
    Output extends AIOutputSpec = AIAnyOutput,
  >(request: AIStreamTextRequest<Tools, RuntimeContext, Output>):
    AIStreamResult<Tools, RuntimeContext, Output> {
    const resolved = resolveLanguageModel(
      this.registry,
      this.config.aliases,
      request.model,
      'smart',
      'streaming'
    );
    return executeAIStreamText(request, { resolved, emitCode: this.emitCode });
  }

  /** Generate text from an explicit conversation message list. */
  generateConversation<
    Tools extends ToolSet = ToolSet,
    RuntimeContext extends Context = Context,
    Output extends AIOutputSpec = AIAnyOutput,
  >(request: AIGenerateConversationRequest<Tools, RuntimeContext, Output>):
    Promise<AITextResult<Tools, RuntimeContext, Output>> {
    return this.generateText({
      ...request,
      messages: request.messages,
    });
  }

  /** Stream text from an explicit conversation message list. */
  streamConversation<
    Tools extends ToolSet = ToolSet,
    RuntimeContext extends Context = Context,
    Output extends AIOutputSpec = AIAnyOutput,
  >(request: AIStreamConversationRequest<Tools, RuntimeContext, Output>):
    AIStreamResult<Tools, RuntimeContext, Output> {
    return this.streamText({
      ...request,
      messages: request.messages,
    });
  }

  /** Generate one embedding vector for a string. */
  async embed<RUNTIME_CONTEXT extends Context = Context>(
    request: AIEmbedRequest<RUNTIME_CONTEXT>
  ): Promise<AIEmbedResult> {
    const resolved = resolveEmbeddingModel(this.registry, this.config.aliases, request.model, 'embedding');
    return executeAIEmbed(request, {
      model: resolved.model,
      requestTelemetry: startAIRequestTelemetry(resolved, 'embeddings', request.metadata),
    });
  }

  /** Generate embeddings for a bounded batch while preserving input order. */
  async embedMany<RUNTIME_CONTEXT extends Context = Context>(
    request: AIEmbedManyRequest<RUNTIME_CONTEXT>
  ): Promise<AIEmbedManyResult> {
    const resolved = resolveEmbeddingModel(
      this.registry,
      this.config.aliases,
      request.model,
      'embedding'
    );
    return executeAIEmbedMany(request, {
      model: resolved.model,
      requestTelemetry: startAIRequestTelemetry(resolved, 'embeddings', request.metadata),
    });
  }

  /** Rerank a bounded homogeneous document set against one query. */
  async rerank<
    VALUE extends AIRerankDocument,
    RUNTIME_CONTEXT extends Context = Context,
  >(request: AIRerankRequest<VALUE, RUNTIME_CONTEXT>): Promise<AIRerankResult<VALUE>> {
    const resolved = resolveRerankingModel(
      this.registry,
      this.config.aliases,
      request.model,
      'reranking'
    );
    return executeAIRerank(request, {
      model: resolved.model,
      requestTelemetry: startAIRequestTelemetry(resolved, 'reranking', request.metadata),
    });
  }

  /** Generate images through a configured image-capable provider. */
  async generateImage(request: AIGenerateImageRequest): Promise<AIImageResult> {
    const resolved = resolveImageModel(this.registry, this.config.aliases, request.model, 'image');
    return executeAIGenerateImage(request, {
      model: resolved.model,
      requestTelemetry: startAIRequestTelemetry(resolved, 'images', request.metadata),
    });
  }

  /** Transcribe audio through a configured transcription-capable provider. */
  async transcribe(request: AITranscribeRequest): Promise<AITranscriptionResult> {
    const resolved = resolveTranscriptionModel(this.registry, this.config.aliases, request.model, 'transcription');
    return executeAITranscription(request, {
      model: resolved.model,
      requestTelemetry: startAIRequestTelemetry(resolved, 'transcription', request.metadata),
    });
  }

  /** Generate speech audio through a configured speech-capable provider. */
  async generateSpeech(request: AIGenerateSpeechRequest): Promise<AISpeechResult> {
    const resolved = resolveSpeechModel(this.registry, this.config.aliases, request.model, 'speech');
    return executeAISpeech(request, {
      model: resolved.model,
      requestTelemetry: startAIRequestTelemetry(resolved, 'speech', request.metadata),
    });
  }
}
