/**
 * index.ts
 *
 * Public server-side barrel for Zero's internal AI layer. Client/browser code
 * should not import this module because it can execute provider SDK calls and
 * read server-side provider configuration.
 */

export { AIError } from './ai-errors';
export { AIService } from './ai-service';
export { AIConversationBuilder, toModelMessages } from './ai-conversation';
export { AIConversationSessionBuilder } from './ai-session';
export { aiTool, defineAITools } from './ai-toolkit';
export { createAIWorkflowHandler, type AIWorkflowHandlerOptions } from './ai-workflow';
export { createAIPlugin, getAI } from './ai.plugin';
export { createMetaLlama, metaLlama } from './adapters/meta-llama';
export { resolveAIConfig } from './ai-env';
export {
  createAIRegistry,
  isAIModelActive,
  parseAIModelReference,
} from './ai-registry';
export type {
  AIConfig,
  AIConversation,
  AIConversationOptions,
  AIConversationSession,
  AIConversationSessionOptions,
  AICapability,
  AIGenerateConversationRequest,
  AIGenerateSpeechRequest,
  AIGenerateTextRequest,
  AIEmbedRequest,
  AIEmbedResult,
  AIImageResult,
  AIMessage,
  AIMessageContent,
  AIProviderCapabilities,
  AIProviderConfig,
  AIProviderStatus,
  AIProviderType,
  AIRequestOptions,
  AISpeechResult,
  AIStatus,
  AIStatusEndpointConfig,
  AIStreamResult,
  AITextResult,
  AITranscriptionResult,
  AITranscribeRequest,
  ResolvedAIConfig,
  ResolvedAIProviderConfig,
} from './ai-types';
