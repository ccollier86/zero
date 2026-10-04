/**
 * ai-types.ts
 *
 * Defines request and result contracts for Zero's internal AI layer and
 * preserves the established provider-type re-exports. These types are
 * framework-neutral so app code can depend on stable platform boundaries.
 */

import type {
  ActiveTools,
  EmbedEndEvent,
  EmbedStartEvent,
  FinishReason,
  GenerateTextInclude,
  GenerateTextOnAbortCallback,
  GenerateTextOnEndCallback,
  GenerateTextOnStartCallback,
  GenerateTextOnStepEndCallback,
  GenerateTextOnStepStartCallback,
  GenerateImageResult,
  GenerateTextResult,
  Instructions,
  LanguageModelCallOptions,
  OnLanguageModelCallEndCallback,
  OnLanguageModelCallStartCallback,
  OnToolExecutionEndCallback,
  OnToolExecutionStartCallback,
  PrepareStepFunction,
  StopCondition,
  StreamTextResult,
  StreamTextInclude,
  StreamTextOnChunkCallback,
  StreamTextOnEndCallback,
  SpeechResult,
  TelemetryOptions,
  TimeoutConfiguration,
  ToolApprovalConfiguration,
  ToolChoice,
  ToolOrder,
  ToolSet,
  TranscriptionResult,
} from 'ai';
import type {
  Context,
  InferToolSetContext,
  ModelMessage,
} from '@ai-sdk/provider-utils';

import type { AIAnyOutput, AIOutputSpec } from './ai-output';
import type { AIHostedFileLocator } from './ai-files-types';

/**
 * Provider-specific request options.
 *
 * The broad record preserves Zero's established source contract. SDK 7
 * providers may apply stricter runtime validation to individual values.
 */
export type AIProviderOptions = Record<string, Record<string, unknown>>;

export type {
  AIConfig,
  AICapability,
  AICustomProviderAdapter,
  AICustomProviderContext,
  AIFetchFunction,
  AIFilesProviderStatus,
  AIAzureTokenProvider,
  AIBedrockCredentialProvider,
  AIBedrockCredentials,
  AIModelAliasStatus,
  AIProviderCapabilities,
  AIProviderFileOperations,
  AIProviderAdapter,
  AIProviderConfig,
  AIProviderInstanceSettings,
  AIProviderSource,
  AIProviderStatus,
  AIProviderType,
  AIAwsCredentialProvider,
  AIStatus,
  AIStatusEndpointConfig,
  AIStatusEndpointReadMode,
  ResolvedAIConfig,
  ResolvedAIProviderCapabilities,
  ResolvedAIProviderConfig,
  ResolvedAIStatusEndpointConfig,
} from './ai-provider-types';

/** Zero conversation roles normalized to AI SDK model messages. */
export type AIMessageRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

/** Text part accepted inside multimodal AI messages. */
export interface AITextContentPart {
  type: 'text';
  text: string;
}

/** Image URL part accepted inside multimodal AI messages. */
export interface AIImageContentPart {
  type: 'image';
  url: string;
  mediaType?: string;
}

/** Shared metadata for file parts accepted inside multimodal AI messages. */
interface AIFileContentPartBase {
  type: 'file';
  mediaType: string;
  filename?: string;
}

/** File part backed by raw data or a URL. */
export interface AIRawFileContentPart extends AIFileContentPartBase {
  data: string | URL | Uint8Array | ArrayBuffer;
  hostedFile?: never;
}

/** File part backed by a durable provider-hosted file locator. */
export interface AIHostedFileContentPart extends AIFileContentPartBase {
  hostedFile: AIHostedFileLocator;
  data?: never;
}

/** File or provider-hosted reference accepted inside multimodal AI messages. */
export type AIFileContentPart = AIRawFileContentPart | AIHostedFileContentPart;

/** User-facing message content accepted by conversation helpers. */
export type AIMessageContent = string | readonly (AITextContentPart | AIImageContentPart | AIFileContentPart)[];

/** Assistant tool call content part used in conversation history. */
export interface AIToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** Tool result content part used in conversation history. */
export interface AIToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName?: string;
  output: unknown;
}

/** Platform-neutral conversation message shape. */
export interface AIMessage {
  role: AIMessageRole;
  content: AIMessageContent | readonly (AITextContentPart | AIToolCallPart | AIToolResultPart)[];
  toolCallId?: string;
}

/** Shared model request options accepted by text and conversation calls. */
export interface AIRequestOptions {
  model?: string;
  maxRetries?: number;
  timeout?: number;
  headers?: Record<string, string | undefined>;
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
  reasoning?: LanguageModelCallOptions['reasoning'];
  maxOutputTokens?: number;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
  providerOptions?: AIProviderOptions;
  metadata?: Record<string, unknown>;
}

/** SDK 7 generation controls shared by text and conversation calls. */
export type AIGenerationOptions<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
> = Omit<AIRequestOptions, 'timeout'> & {
  /** Preferred trusted instructions. `system` remains supported for compatibility. */
  instructions?: Instructions;
  /** @deprecated Use `instructions`; retained for existing Zero applications. */
  system?: string;
  output?: Output;
  timeout?: TimeoutConfiguration<Tools>;
  tools?: Tools;
  toolChoice?: ToolChoice<Tools>;
  toolsContext?: InferToolSetContext<Tools>;
  runtimeContext?: RuntimeContext;
  activeTools?: ActiveTools<Tools>;
  toolOrder?: ToolOrder<Tools>;
  stopWhen?: StopCondition<Tools, RuntimeContext> | readonly StopCondition<Tools, RuntimeContext>[];
  prepareStep?: PrepareStepFunction<Tools, RuntimeContext>;
  toolApproval?: ToolApprovalConfiguration<Tools, RuntimeContext>;
  /** HMAC key used by SDK 7 to sign and verify tool approval requests. */
  toolApprovalSecret?: string | Uint8Array;
  telemetry?: TelemetryOptions<RuntimeContext, Tools>;
  include?: GenerateTextInclude;
  onStart?: GenerateTextOnStartCallback<Tools, RuntimeContext, Output>;
  onStepStart?: GenerateTextOnStepStartCallback<Tools, RuntimeContext, Output>;
  onLanguageModelCallStart?: OnLanguageModelCallStartCallback;
  onLanguageModelCallEnd?: OnLanguageModelCallEndCallback<Tools>;
  onToolExecutionStart?: OnToolExecutionStartCallback<Tools>;
  onToolExecutionEnd?: OnToolExecutionEndCallback<Tools>;
  onStepEnd?: GenerateTextOnStepEndCallback<Tools, RuntimeContext>;
  onEnd?: GenerateTextOnEndCallback<Tools, RuntimeContext>;
};

/** Retry-aware stream error observer supported by AI SDK 7. */
export type AIStreamErrorCallback = (event: { error: unknown }) =>
  | void
  | { retry: true }
  | PromiseLike<void | { retry: true }>;

/** SDK 7 controls that apply only to streamed generation. */
export type AIStreamGenerationOptions<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
> = Omit<AIGenerationOptions<Tools, RuntimeContext, Output>, 'include' | 'onEnd' | 'onAbort'> & {
  /** Provider-stream retries after a response has begun. Omit to disable. */
  streamRetries?: number;
  include?: GenerateTextInclude & StreamTextInclude;
  onChunk?: StreamTextOnChunkCallback<Tools>;
  onError?: AIStreamErrorCallback;
  onEnd?: StreamTextOnEndCallback<Tools, RuntimeContext, Output>;
  onAbort?: GenerateTextOnAbortCallback<Tools, RuntimeContext>;
};

/** Request shape for one-shot text generation or streaming. */
export type AIGenerateTextRequest<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
> = AIGenerationOptions<Tools, RuntimeContext, Output> & {
  prompt?: string;
  messages?: readonly AIMessage[];
};

/** Request shape for streamed text generation. */
export type AIStreamTextRequest<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
> = AIStreamGenerationOptions<Tools, RuntimeContext, Output> & {
  prompt?: string;
  messages?: readonly AIMessage[];
};

/** Request shape for explicit multi-turn conversation generation. */
export type AIGenerateConversationRequest<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
> = AIGenerationOptions<Tools, RuntimeContext, Output> & {
  messages: readonly AIMessage[];
};

/** Request shape for an explicit streamed conversation. */
export type AIStreamConversationRequest<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
> = AIStreamGenerationOptions<Tools, RuntimeContext, Output> & {
  messages: readonly AIMessage[];
};

/** Request shape for a single text embedding call. */
export interface AIEmbedRequest<RUNTIME_CONTEXT extends Context = Context> {
  model?: string;
  value: string;
  maxRetries?: number;
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
  providerOptions?: AIProviderOptions;
  metadata?: Record<string, unknown>;
  runtimeContext?: RUNTIME_CONTEXT;
  telemetry?: TelemetryOptions<RUNTIME_CONTEXT>;
  onStart?: (event: EmbedStartEvent<RUNTIME_CONTEXT>) => PromiseLike<void> | void;
  onEnd?: (event: EmbedEndEvent<RUNTIME_CONTEXT>) => PromiseLike<void> | void;
}

/** Stable embedding result returned by AIService.embed(). */
export interface AIEmbedResult {
  embedding: number[];
  value: string;
  usage?: unknown;
}

/** Request shape for image generation through an image-capable provider. */
export type AIDataContent = string | Uint8Array | ArrayBuffer;

export type AIImagePrompt = string | {
  images: AIDataContent[];
  text?: string;
  mask?: AIDataContent;
};

export interface AIGenerateImageRequest {
  model?: string;
  prompt: AIImagePrompt;
  n?: number;
  maxImagesPerCall?: number;
  size?: `${number}x${number}`;
  aspectRatio?: `${number}:${number}`;
  seed?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
  providerOptions?: AIProviderOptions;
  metadata?: Record<string, unknown>;
}

/** Bounded URL downloader accepted by transcription requests. */
export type AITranscriptionDownload = (options: {
  url: URL;
  abortSignal?: AbortSignal;
}) => Promise<{ data: Uint8Array; mediaType: string | undefined }>;

/** Request shape for audio transcription through a transcription provider. */
export interface AITranscribeRequest {
  model?: string;
  audio: string | URL | Uint8Array | ArrayBuffer;
  maxRetries?: number;
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
  providerOptions?: AIProviderOptions;
  telemetry?: TelemetryOptions;
  download?: AITranscriptionDownload;
  metadata?: Record<string, unknown>;
}

/** Request shape for text-to-speech through a speech-capable provider. */
export interface AIGenerateSpeechRequest {
  model?: string;
  text: string;
  voice?: string;
  outputFormat?: 'mp3' | 'wav' | (string & {});
  instructions?: string;
  speed?: number;
  language?: string;
  maxRetries?: number;
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
  providerOptions?: AIProviderOptions;
  telemetry?: TelemetryOptions;
  metadata?: Record<string, unknown>;
}

/** Options carried by a chainable AIConversationBuilder. */
export type AIConversationOptions<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
> = Omit<AIGenerationOptions<Tools, RuntimeContext, AIAnyOutput>, 'output'> & {
  messages?: readonly AIMessage[];
};

/** Options for a bounded, non-persistent server-side conversation session. */
export type AIConversationSessionOptions<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
> = AIConversationOptions<Tools, RuntimeContext> & {
  /** Maximum messages retained in local memory. Default: 32. */
  maxMessages?: number;
  /** Approximate maximum retained message content characters. */
  maxCharacters?: number;
};

/** Chainable helper contract for multi-turn conversations. */
export interface AIConversation<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
> {
  /** Append a system message to this conversation. */
  system(content: string): this;
  /** Append a user message to this conversation. */
  user(content: AIMessageContent): this;
  /** Append an assistant message to this conversation. */
  assistant(content: string | readonly AITextContentPart[]): this;
  /** Append a tool result message to this conversation. */
  tool(toolCallId: string, output: unknown, toolName?: string): this;
  /** Return the normalized message list currently owned by this builder. */
  messages(): readonly AIMessage[];
  /** Generate a final response using the current messages. */
  generate<Output extends AIOutputSpec = AIAnyOutput>(
    options?: Omit<AIGenerationOptions<Tools, RuntimeContext, Output>, 'tools'>
  ): Promise<GenerateTextResult<Tools, RuntimeContext, Output>>;
  /** Stream a response using the current messages. */
  stream<Output extends AIOutputSpec = AIAnyOutput>(
    options?: Omit<AIStreamGenerationOptions<Tools, RuntimeContext, Output>, 'tools'>
  ): StreamTextResult<Tools, RuntimeContext, Output>;
}

/** Transient server-side conversation helper that appends user/assistant turns. */
export interface AIConversationSession<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
> {
  /** Append any message to the bounded in-memory history. */
  append(message: AIMessage): this;
  /** Append a user message without calling a provider. */
  user(content: AIMessageContent): this;
  /** Append an assistant message without calling a provider. */
  assistant(content: string): this;
  /** Return the current bounded message list. */
  messages(): readonly AIMessage[];
  /** Clear history while preserving the configured system prompt. */
  clear(): this;
  /** Append one user message, call the selected model, and store the answer. */
  send<Output extends AIOutputSpec = AIAnyOutput>(
    content: AIMessageContent,
    options?: Omit<AIGenerationOptions<Tools, RuntimeContext, Output>, 'tools'>
  ): Promise<GenerateTextResult<Tools, RuntimeContext, Output>>;
}

/** AI SDK text generation result returned by Zero's service boundary. */
export type AITextResult<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
> = GenerateTextResult<Tools, RuntimeContext, Output>;
/** AI SDK stream result returned by Zero's service boundary. */
export type AIStreamResult<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
> = StreamTextResult<Tools, RuntimeContext, Output>;
/** AI SDK image generation result returned by Zero's service boundary. */
export type AIImageResult = GenerateImageResult;
/** AI SDK transcription result returned by Zero's service boundary. */
export type AITranscriptionResult = TranscriptionResult;
/** AI SDK speech generation result returned by Zero's service boundary. */
export type AISpeechResult = SpeechResult;

/** Normalized AI SDK model message type emitted by `toModelMessages()`. */
export type AIModelMessage = ModelMessage;
