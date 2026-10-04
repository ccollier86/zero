/**
 * index.ts
 *
 * Public server-side barrel for Zero's internal AI layer. Client/browser code
 * should not import this module because it can execute provider SDK calls and
 * read server-side provider configuration.
 */

export { AIError, type AIErrorCode } from './ai-errors';
export { AIOutput } from './ai-output';
export { AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES } from './ai-prompt-download';
export type {
  AIAnyOutput,
  AIInferOutput,
  AIInferPartialOutput,
  AIOutputSpec,
  AITextOutput,
} from './ai-output';
export { AIService } from './ai-service';
export type { AIServiceOptions } from './ai-service';
export {
  createAIModelExecutionPreparer,
  prepareDirectAIModelExecution,
} from './ai-model-execution';
export type {
  AIDirectModelExecutionOptions,
  AIModelExecutionPreparerOptions,
  AIModelExecutionRequest,
  AIPreparedModelExecution,
  AIPrepareModelExecution,
} from './ai-model-execution';
export { AIConversationBuilder, toModelMessages } from './ai-conversation';
export type { AIMessageNormalizationOptions } from './ai-conversation';
export { AIConversationSessionBuilder } from './ai-session';
export * from './agents';
export * from './durable';
export type { AIEmbedManyRequest, AIEmbedManyResult } from './ai-embedding-types';
export {
  createAIHostedFilesService,
} from './ai-files-service';
export type {
  AIHostedFilesService,
  AIHostedFilesServiceContext,
} from './ai-files-service';
export {
  AI_DEFAULT_HOSTED_FILE_MAX_BYTES,
} from './ai-files-types';
export type {
  AIHostedFileDeleteRequest,
  AIHostedFileDeleteResult,
  AIHostedFileDownload,
  AIHostedFileDownloadRequest,
  AIHostedFileLocator,
  AIHostedFileMetadata,
  AIHostedFileMetadataRequest,
  AIHostedFileRequestOptions,
  AIHostedFileUploadRequest,
  AIHostedFileUploadSource,
} from './ai-files-types';
export type {
  AIRerankDocument,
  AIRerankRequest,
  AIRerankResult,
} from './ai-rerank-types';
export {
  createAIVideoService,
} from './ai-video-service';
export type {
  AIVideoService,
  AIVideoServiceContext,
} from './ai-video-service';
export {
  AI_DEFAULT_VIDEO_DOWNLOAD_MAX_BYTES,
} from './ai-video-types';
export type {
  AIGenerateVideoRequest,
  AIGenerateVideoResult,
  AIGetVideoStatusRequest,
  AIStartVideoRequest,
  AIStartVideoResult,
  AIVideoFrameImage,
  AIVideoInputReference,
  AIVideoOperationEnvelope,
  AIVideoPollOptions,
  AIVideoRequestOptions,
  AIVideoStatusResult,
  AIVideoWebhookFactory,
} from './ai-video-types';
export { aiTool, defineAITools } from './ai-toolkit';
export { createAIWorkflowHandler, type AIWorkflowHandlerOptions } from './ai-workflow';
export { createAIPlugin, getAI } from './ai.plugin';
export { createMetaLlama, metaLlama } from './adapters/meta-llama';
export { resolveAIConfig } from './ai-env';
export { AI_PROVIDER_CATALOG, AI_PROVIDER_TYPES } from './ai-provider-catalog';
export type {
  AIProviderActivationKind,
  AIProviderCatalogEntry,
  AIProviderSettingEnvKeys,
} from './ai-provider-catalog';
export {
  createAIRegistry,
  isAIModelActive,
  parseAIModelReference,
} from './ai-registry';
export type {
  AIRegistry,
  ResolvedAIFilesProvider,
  ResolvedAIModel,
} from './ai-registry';
export type {
  AIConfig,
  AICapability,
  AICustomProviderAdapter,
  AICustomProviderContext,
  AIFetchFunction,
  AIFilesProviderStatus,
  AIAzureTokenProvider,
  AIAwsCredentialProvider,
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
  AIStatus,
  AIStatusEndpointConfig,
  AIStatusEndpointReadMode,
  ResolvedAIConfig,
  ResolvedAIProviderCapabilities,
  ResolvedAIProviderConfig,
  ResolvedAIStatusEndpointConfig,
} from './ai-provider-types';
export type {
  AIConversation,
  AIConversationOptions,
  AIConversationSession,
  AIConversationSessionOptions,
  AIDataContent,
  AIGenerationOptions,
  AIGenerateConversationRequest,
  AIGenerateImageRequest,
  AIGenerateSpeechRequest,
  AIGenerateTextRequest,
  AIEmbedRequest,
  AIEmbedResult,
  AIFileContentPart,
  AIHostedFileContentPart,
  AIImageResult,
  AIImageContentPart,
  AIImagePrompt,
  AIMessage,
  AIMessageContent,
  AIProviderOptions,
  AIRequestOptions,
  AIRawFileContentPart,
  AISpeechResult,
  AIStreamResult,
  AIStreamConversationRequest,
  AIStreamErrorCallback,
  AIStreamGenerationOptions,
  AIStreamTextRequest,
  AITextResult,
  AITextContentPart,
  AITranscriptionResult,
  AITranscriptionDownload,
  AITranscribeRequest,
} from './ai-types';
