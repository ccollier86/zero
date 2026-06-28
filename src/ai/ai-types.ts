/**
 * ai-types.ts
 *
 * Defines public contracts for Zero's internal AI layer. These types are
 * framework-neutral and intentionally avoid provider SDK concrete classes so
 * app code can depend on stable platform boundaries.
 */

import type {
  FinishReason,
  GenerateImageResult,
  GenerateTextResult,
  StreamTextResult,
  ToolChoice,
  ToolSet,
  Experimental_SpeechResult as SpeechResult,
  Experimental_TranscriptionResult as TranscriptionResult,
} from 'ai';
import type { ProviderV3 } from '@ai-sdk/provider';
import type { ModelMessage } from '@ai-sdk/provider-utils';

/** Built-in provider adapter identifiers accepted by Zero AI config. */
export type AIProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'xai'
  | 'cohere'
  | 'deepgram'
  | 'openai-compatible'
  | 'meta-llama'
  | 'custom';

/** Model capabilities used for provider status and request validation. */
export type AICapability =
  | 'text'
  | 'streaming'
  | 'tools'
  | 'vision'
  | 'embeddings'
  | 'images'
  | 'transcription'
  | 'speech';

/** Tracks whether a provider came from env auto-detection or explicit config. */
export type AIProviderSource = 'env' | 'config';

/** Context passed to a custom AI SDK provider adapter factory. */
export interface AICustomProviderContext {
  id: string;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  capabilities: AIProviderCapabilities;
}

/** AI SDK provider object or factory accepted by `type: 'custom'`. */
export type AICustomProviderAdapter =
  | ProviderV3
  | ((context: AICustomProviderContext) => ProviderV3);

/** Capability flags advertised by a configured provider. */
export interface AIProviderCapabilities {
  text: boolean;
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  embeddings: boolean;
  images: boolean;
  transcription: boolean;
  speech: boolean;
}

/** Developer-provided provider configuration accepted by `createApp({ ai })`. */
export interface AIProviderConfig {
  /** Provider adapter type. */
  type: AIProviderType;
  /** Set false to keep a configured provider visible but inactive. */
  enabled?: boolean;
  /** API key or token. Omit to let env auto-detection provide it. */
  apiKey?: string | null;
  /** Custom provider base URL. Required for most openai-compatible providers. */
  baseURL?: string | null;
  /** Extra headers for provider adapters that support them. */
  headers?: Record<string, string>;
  /** Optional capability override for custom providers. */
  capabilities?: Partial<AIProviderCapabilities>;
  /** AI SDK provider object or factory. Required when `type` is `custom`. */
  adapter?: AICustomProviderAdapter;
}

/** Status endpoint access policy accepted by the AI plugin. */
export type AIStatusEndpointReadMode =
  | 'admin'
  | 'development'
  | 'admin-or-dev'
  | 'disabled'
  | ((ctx: {
    request: Request;
    authContext: { userId: string; email?: string; role?: string } | null;
  }) => boolean | Promise<boolean>);

/** Configuration for the optional public-safe AI status endpoint. */
export interface AIStatusEndpointConfig {
  /** Set true to expose the optional `/api/_zero/ai/status` route. */
  enabled?: boolean;
  /** Endpoint base path. Default: `/api/_zero/ai`. */
  basePath?: string;
  /** Read policy. Defaults to admin with auth, development without auth. */
  read?: AIStatusEndpointReadMode;
}

/** Top-level AI configuration accepted by `createApp()`. */
export interface AIConfig {
  /** Set false to disable env scanning and only use explicit providers. */
  autoDetect?: boolean;
  /** Explicit provider definitions. Config wins over env auto-detection. */
  providers?: Record<string, AIProviderConfig | false>;
  /** Friendly model aliases such as `fast`, `smart`, `embedding`, and `image`. */
  aliases?: Record<string, string>;
  /** Optional provider status endpoint configuration. Default: no AI routes. */
  statusEndpoint?: false | AIStatusEndpointConfig;
}

/** Provider config after env/config detection, normalization, and activation. */
export interface ResolvedAIProviderConfig extends AIProviderConfig {
  id: string;
  source: AIProviderSource;
  active: boolean;
  configuredBy: string[];
  capabilities: AIProviderCapabilities;
  reason: string | null;
}

/** Resolved AI status endpoint settings consumed by the Elysia plugin. */
export interface ResolvedAIStatusEndpointConfig {
  enabled: boolean;
  basePath: string;
  read?: AIStatusEndpointReadMode;
}

/** Fully normalized AI runtime config consumed by AIService and the plugin. */
export interface ResolvedAIConfig {
  enabled: true;
  autoDetect: boolean;
  providers: Record<string, ResolvedAIProviderConfig>;
  aliases: Record<string, string>;
  statusEndpoint: ResolvedAIStatusEndpointConfig;
}

/** Public-safe provider status returned by the status endpoint. */
export interface AIProviderStatus {
  id: string;
  type: AIProviderType;
  active: boolean;
  source: AIProviderSource;
  configuredBy: string[];
  baseURL: string | null;
  capabilities: AIProviderCapabilities;
  reason: string | null;
}

/** Public-safe model alias status returned by the status endpoint. */
export interface AIModelAliasStatus {
  model: string;
  active: boolean;
  reason: string | null;
}

/** Public-safe AI runtime status returned by AIService.status(). */
export interface AIStatus {
  enabled: boolean;
  providers: AIProviderStatus[];
  aliases: Record<string, AIModelAliasStatus>;
}

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

/** File or binary part accepted inside multimodal AI messages. */
export interface AIFileContentPart {
  type: 'file';
  data: string | URL | Uint8Array | ArrayBuffer;
  mediaType: string;
  filename?: string;
}

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
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
  providerOptions?: Record<string, Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

/** Request shape for one-shot text generation or streaming. */
export interface AIGenerateTextRequest extends AIRequestOptions {
  prompt?: string;
  system?: string;
  messages?: readonly AIMessage[];
  tools?: ToolSet;
  toolChoice?: ToolChoice<ToolSet>;
}

/** Request shape for explicit multi-turn conversation generation. */
export interface AIGenerateConversationRequest extends AIRequestOptions {
  system?: string;
  messages: readonly AIMessage[];
  tools?: ToolSet;
  toolChoice?: ToolChoice<ToolSet>;
}

/** Request shape for a single text embedding call. */
export interface AIEmbedRequest {
  model?: string;
  value: string;
  abortSignal?: AbortSignal;
  providerOptions?: Record<string, Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

/** Stable embedding result returned by AIService.embed(). */
export interface AIEmbedResult {
  embedding: number[];
  value: string;
  usage?: unknown;
}

/** Request shape for image generation through an image-capable provider. */
export interface AIGenerateImageRequest {
  model?: string;
  prompt: string;
  n?: number;
  size?: `${number}x${number}`;
  aspectRatio?: `${number}:${number}`;
  seed?: number;
  abortSignal?: AbortSignal;
  providerOptions?: Record<string, Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

/** Request shape for audio transcription through a transcription provider. */
export interface AITranscribeRequest {
  model?: string;
  audio: string | URL | Uint8Array | ArrayBuffer;
  abortSignal?: AbortSignal;
  providerOptions?: Record<string, Record<string, unknown>>;
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
  providerOptions?: Record<string, Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

/** Options carried by a chainable AIConversationBuilder. */
export interface AIConversationOptions extends AIRequestOptions {
  system?: string;
  messages?: readonly AIMessage[];
  tools?: ToolSet;
  toolChoice?: ToolChoice<ToolSet>;
}

/** Options for a bounded, non-persistent server-side conversation session. */
export interface AIConversationSessionOptions extends AIConversationOptions {
  /** Maximum messages retained in local memory. Default: 32. */
  maxMessages?: number;
  /** Approximate maximum retained message content characters. */
  maxCharacters?: number;
}

/** Chainable helper contract for multi-turn conversations. */
export interface AIConversation {
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
  generate(options?: AIRequestOptions): Promise<GenerateTextResult<ToolSet, any>>;
  /** Stream a response using the current messages. */
  stream(options?: AIRequestOptions): StreamTextResult<ToolSet, any>;
}

/** Transient server-side conversation helper that appends user/assistant turns. */
export interface AIConversationSession {
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
  send(content: AIMessageContent, options?: AIRequestOptions): Promise<GenerateTextResult<ToolSet, any>>;
}

/** AI SDK text generation result returned by Zero's service boundary. */
export type AITextResult = GenerateTextResult<ToolSet, any>;
/** AI SDK stream result returned by Zero's service boundary. */
export type AIStreamResult = StreamTextResult<ToolSet, any>;
/** AI SDK image generation result returned by Zero's service boundary. */
export type AIImageResult = GenerateImageResult;
/** AI SDK transcription result returned by Zero's service boundary. */
export type AITranscriptionResult = TranscriptionResult;
/** AI SDK speech generation result returned by Zero's service boundary. */
export type AISpeechResult = SpeechResult;

/** Normalized AI SDK model message type emitted by `toModelMessages()`. */
export type AIModelMessage = ModelMessage;
