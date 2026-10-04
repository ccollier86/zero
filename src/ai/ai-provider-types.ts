/**
 * ai-provider-types.ts
 *
 * Public configuration, activation, and status contracts for Zero's AI
 * provider boundary. These declarations stay separate from request/result
 * types so provider construction can evolve without coupling to AI calls.
 */

import type { ProviderV3, ProviderV4 } from '@ai-sdk/provider';
import type { BasetenProviderSettings } from '@ai-sdk/baseten';
import type { CartesiaProviderSettings } from '@ai-sdk/cartesia';
import type { GoogleVertexProviderSettings } from '@ai-sdk/google-vertex';

/** Portable fetch contract accepted from Bun apps without requiring Bun's static helpers. */
export type AIFetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/** Built-in provider adapter identifiers accepted by Zero AI config. */
export type AIProviderType =
  | 'gateway'
  | 'openai'
  | 'azure'
  | 'anthropic'
  | 'anthropic-aws'
  | 'amazon-bedrock'
  | 'google'
  | 'google-vertex'
  | 'groq'
  | 'xai'
  | 'cohere'
  | 'mistral'
  | 'togetherai'
  | 'deepinfra'
  | 'deepseek'
  | 'cerebras'
  | 'perplexity'
  | 'fireworks'
  | 'voyage'
  | 'fal'
  | 'luma'
  | 'deepgram'
  | 'elevenlabs'
  | 'hume'
  | 'revai'
  | 'assemblyai'
  | 'gladia'
  | 'fish-audio'
  | 'replicate'
  | 'prodia'
  | 'black-forest-labs'
  | 'bytedance'
  | 'klingai'
  | 'cartesia'
  | 'gmicloud'
  | 'quiverai'
  | 'baseten'
  | 'huggingface'
  | 'open-responses'
  | 'moonshotai'
  | 'alibaba'
  | 'minimax'
  | 'zai'
  | 'topaz'
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
  | 'speech'
  | 'reranking'
  | 'video'
  | 'files'
  | 'fileMetadata'
  | 'fileDownload'
  | 'fileDelete'
  | 'skills'
  | 'realtime'
  | 'evaluation'
  | 'batch';

/** Tracks whether a provider came from env auto-detection or explicit config. */
export type AIProviderSource = 'env' | 'config';

/** Context passed to a custom AI SDK provider adapter factory. */
export interface AICustomProviderContext {
  id: string;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: AIFetchFunction;
  settings?: AIProviderInstanceSettings;
  capabilities: AIProviderCapabilities;
}

/** AI SDK provider generations accepted by Zero's compatibility boundary. */
export type AIProviderAdapter = ProviderV3 | ProviderV4;

/** AI SDK provider object or factory accepted by `type: 'custom'`. */
export type AICustomProviderAdapter =
  | AIProviderAdapter
  | ((context: AICustomProviderContext) => AIProviderAdapter);

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
  reranking?: boolean;
  /** Preview AI SDK video-model surface. */
  video?: boolean;
  /** Provider-hosted file uploads. */
  files?: boolean;
  /** Optional metadata reads for provider-hosted files. */
  fileMetadata?: boolean;
  /** Optional downloads for provider-hosted files. */
  fileDownload?: boolean;
  /** Optional deletion for provider-hosted files. */
  fileDelete?: boolean;
  skills?: boolean;
  /** Preview realtime-model surface. */
  realtime?: boolean;
  /** Preview evaluation-model surface. */
  evaluation?: boolean;
  /** Preview provider batch surface. */
  batch?: boolean;
}

/** Fully populated capability map used after provider config normalization. */
export type ResolvedAIProviderCapabilities = Required<AIProviderCapabilities>;

/** Public-safe operation support for one provider-hosted files interface. */
export interface AIProviderFileOperations {
  upload: boolean;
  metadata: boolean;
  download: boolean;
  delete: boolean;
}

/** AWS credentials returned by an AWS-authenticated provider. */
export interface AIBedrockCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** Dynamic AWS credential provider accepted by AWS-authenticated adapters. */
export type AIAwsCredentialProvider = () => PromiseLike<AIBedrockCredentials>;

/** @deprecated Use `AIAwsCredentialProvider`; retained for source compatibility. */
export type AIBedrockCredentialProvider = AIAwsCredentialProvider;

/** Dynamic Microsoft Entra token provider accepted by the Azure adapter. */
export type AIAzureTokenProvider = () => Promise<string>;

/**
 * Provider-specific construction settings.
 *
 * Settings unsupported by the selected provider type are rejected during
 * config resolution. Credentials remain server-only and are never projected
 * through AI status responses.
 */
export interface AIProviderInstanceSettings {
  /** Vercel team id or slug used to scope AI Gateway requests. */
  teamIdOrSlug?: string;
  /** Anthropic bearer-token credential used instead of an API key. */
  authToken?: string;
  /** Anthropic workspace hosted by Claude Platform on AWS. */
  workspaceId?: string;
  /** AWS region used by AWS-authenticated providers. */
  region?: string;
  /** Bedrock Runtime endpoint used by language, embedding, and image models. */
  runtimeBaseURL?: string;
  /** Bedrock Agent Runtime endpoint used by reranking models. */
  agentRuntimeBaseURL?: string;
  /** Static AWS access key used by AWS-authenticated providers. */
  accessKeyId?: string;
  /** Static AWS secret key used by AWS-authenticated providers. */
  secretAccessKey?: string;
  /** Optional temporary AWS session token used by AWS-authenticated providers. */
  sessionToken?: string;
  /** Dynamic AWS credentials used by AWS-authenticated providers. */
  credentialProvider?: AIAwsCredentialProvider;
  /** Legacy Kling AI access key used with `secretKey`. */
  accessKey?: string;
  /** Legacy Kling AI signing secret used with `accessKey`. */
  secretKey?: string;
  /** Azure OpenAI resource name when no complete base URL is supplied. */
  resourceName?: string;
  /** Dynamic Microsoft Entra token provider used instead of an Azure API key. */
  tokenProvider?: AIAzureTokenProvider;
  /** Azure OpenAI API version override. */
  apiVersion?: string;
  /** Azure OpenAI speech endpoint override. */
  speechBaseURL?: string;
  /** Use Azure's legacy deployment-based URL form. */
  useDeploymentBasedUrls?: boolean;
  /** Google Cloud project used by Vertex AI. */
  project?: string;
  /** Google Cloud location used by Vertex AI. */
  location?: string;
  /** Authentication options forwarded to Google Auth for Vertex AI. */
  googleAuthOptions?: GoogleVertexProviderSettings['googleAuthOptions'];
  /** AI Gateway metadata-cache refresh interval. */
  metadataCacheRefreshMillis?: number;
  /** Open Responses strict assistant-history serialization. */
  strictResponseInput?: boolean;
  /** Baseten model URL override. */
  modelURL?: string;
  /** Baseten performance client supplied by application code. */
  performanceClient?: BasetenProviderSettings['performanceClient'];
  /** Alibaba embedding endpoint override. */
  embeddingBaseURL?: string;
  /** Alibaba or MiniMax video endpoint override. */
  videoBaseURL?: string;
  /** Include provider usage details when supported. */
  includeUsage?: boolean;
  /** Polling interval used by asynchronous media providers. */
  pollIntervalMillis?: number;
  /** Polling timeout used by asynchronous media providers. */
  pollTimeoutMillis?: number;
  /** Optional request identifier factory supported by select providers. */
  generateId?: () => string;
  /** Provider API version header supported by Cartesia. */
  version?: string;
  /** WebSocket constructor used by Cartesia realtime transcription. */
  webSocket?: CartesiaProviderSettings['webSocket'];
}

/** Developer-provided provider configuration accepted by `createApp({ ai })`. */
export interface AIProviderConfig {
  /** Provider adapter type. */
  type: AIProviderType;
  /** Set false to keep a configured provider visible but inactive. */
  enabled?: boolean;
  /** API key/token. Omit to inherit env; use null to suppress ambient API-key auth. */
  apiKey?: string | null;
  /** Endpoint override. Omit to inherit env; use null to suppress ambient overrides. */
  baseURL?: string | null;
  /** Extra headers for provider adapters that support them. */
  headers?: Record<string, string>;
  /** Custom fetch implementation for proxies, tests, or request middleware. */
  fetch?: AIFetchFunction;
  /** Provider-specific cloud, endpoint, and construction settings. */
  settings?: AIProviderInstanceSettings;
  /** Built-ins may reduce capabilities; custom providers may define their full surface. */
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
  /** Default configured provider id used by provider-hosted file operations. */
  filesProvider?: string;
  /** Optional provider status endpoint configuration. Default: no AI routes. */
  statusEndpoint?: false | AIStatusEndpointConfig;
}

/** Provider config after env/config detection, normalization, and activation. */
export interface ResolvedAIProviderConfig extends AIProviderConfig {
  id: string;
  source: AIProviderSource;
  active: boolean;
  /** True when explicit `baseURL: null` must suppress SDK-level environment fallback. */
  baseURLSuppressed?: true;
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
  /** Resolved default provider id for hosted files, or null when callers must select one. */
  filesProvider?: string | null;
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

/** Public-safe readiness for the configured provider-hosted files default. */
export interface AIFilesProviderStatus {
  providerId: string;
  active: boolean;
  reason: string | null;
  operations: AIProviderFileOperations;
}

/** Public-safe AI runtime status returned by AIService.status(). */
export interface AIStatus {
  enabled: boolean;
  providers: AIProviderStatus[];
  aliases: Record<string, AIModelAliasStatus>;
  /** Null when no default files provider was configured. */
  filesProvider?: AIFilesProviderStatus | null;
}
