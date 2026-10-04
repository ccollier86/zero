/** Pure request normalization and capability guards used by AIService. */

import {
  InvalidArgumentError,
  InvalidDataContentError,
  InvalidMessageRoleError,
  InvalidPromptError,
  InvalidResponseDataError,
  InvalidStreamPartError,
  InvalidToolApprovalError,
  InvalidToolApprovalSignatureError,
  InvalidToolInputError,
  MessageConversionError,
  MissingToolResultsError,
  NoContentGeneratedError,
  NoImageGeneratedError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  NoSpeechGeneratedError,
  NoSuchToolError,
  NoTranscriptGeneratedError,
  NoVideoGeneratedError,
  ToolCallNotFoundForApprovalError,
  ToolCallRepairError,
  ToolChoiceViolationError,
  UnsupportedFunctionalityError,
  UnsupportedModelVersionError,
  type Instructions,
  type ModelMessage,
  type SystemModelMessage,
} from 'ai';

import { AIError } from './ai-errors';
import { normalizeAIProviderOptions } from './ai-provider-options';
import { isAIModelActive } from './ai-registry';
import { toModelMessages } from './ai-conversation';
import type {
  AIGenerateTextRequest,
  ResolvedAIProviderConfig,
} from './ai-types';

/** Normalize Zero prompt/message input into the mutually exclusive SDK shape. */
export function promptInput(
  request: Pick<AIGenerateTextRequest, 'prompt' | 'messages' | 'instructions' | 'system'>,
  providerId?: string
):
  | { prompt: string; messages?: undefined; instructions?: Instructions }
  | { messages: ReturnType<typeof toModelMessages>; prompt?: undefined; instructions?: Instructions } {
  const instructionMessages = normalizeInstructions(request.instructions);
  appendInstruction(instructionMessages, request.system);

  if (request.messages) {
    const nonInstructionMessages = [];

    for (const message of request.messages) {
      if (message.role !== 'system' && message.role !== 'developer') {
        nonInstructionMessages.push(message);
        continue;
      }

      const normalized = toModelMessages([message], { providerId })[0];
      if (normalized.role !== 'system') continue;
      appendInstruction(instructionMessages, normalized);
    }

    const messages = toModelMessages(nonInstructionMessages, { providerId });
    return {
      messages,
      ...instructionsProperty(instructionMessages),
    };
  }
  return {
    prompt: request.prompt ?? '',
    ...instructionsProperty(instructionMessages),
  };
}

function normalizeInstructions(instructions: Instructions | undefined): SystemModelMessage[] {
  if (!instructions) return [];
  if (typeof instructions === 'string') {
    return [{ role: 'system' as const, content: instructions }];
  }
  return Array.isArray(instructions)
    ? instructions.map(normalizeInstruction)
    : [normalizeInstruction(instructions)];
}

function normalizeInstruction(instruction: SystemModelMessage): SystemModelMessage {
  const providerOptions = normalizeAIProviderOptions(instruction.providerOptions);
  return {
    role: 'system',
    content: instruction.content,
    ...(providerOptions === undefined ? {} : { providerOptions }),
  };
}

function appendInstruction(
  instructions: SystemModelMessage[],
  value: string | SystemModelMessage | undefined
): void {
  if (!value) return;
  const normalized = typeof value === 'string'
    ? { role: 'system' as const, content: value }
    : value;
  if (instructions.some((instruction) => instruction.content === normalized.content)) return;
  instructions.push(normalized);
}

function instructionsProperty(
  instructions: SystemModelMessage[]
): { instructions?: Instructions } {
  if (instructions.length === 0) return {};
  if (instructions.length === 1 && !instructions[0].providerOptions) {
    return { instructions: instructions[0].content };
  }
  return { instructions: instructions as Instructions };
}

/** Enforce request-level capabilities before making an external provider call. */
export function assertLanguageRequestCapabilities(
  provider: ResolvedAIProviderConfig,
  request: Pick<AIGenerateTextRequest, 'messages' | 'tools'>
): void {
  assertLanguageCapabilities(provider, {
    messages: request.messages,
    toolNames: Object.keys(request.tools ?? {}),
  });
}

/** Enforce capabilities for already-normalized SDK model messages. */
export function assertLanguageModelExecutionCapabilities(
  provider: ResolvedAIProviderConfig,
  request: Readonly<{
    messages: readonly ModelMessage[];
    toolNames: readonly string[];
  }>,
): void {
  assertLanguageCapabilities(provider, request);
}

function assertLanguageCapabilities(
  provider: ResolvedAIProviderConfig,
  request: Readonly<{
    messages?: readonly { readonly content: unknown }[];
    toolNames: readonly string[];
  }>,
): void {
  if (request.toolNames.length > 0 && !provider.capabilities.tools) {
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

/** Resolve the capability implied by a conventional model alias. */
export function capabilityForAlias(alias: string): Parameters<typeof isAIModelActive>[3] {
  switch (alias) {
    case 'embedding': return 'embeddings';
    case 'image': return 'images';
    case 'transcription': return 'transcription';
    case 'speech': return 'speech';
    case 'reranking': return 'reranking';
    case 'video': return 'video';
    default: return 'text';
  }
}

/** Normalize unknown provider failures into Zero's stable AI error contract. */
export function normalizeAIRequestError(
  error: unknown,
  abortSignal?: AbortSignal,
): AIError {
  if (error instanceof AIError) return error;
  if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
    return new AIError(
      'The AI provider response did not match the requested output.',
      'AI_OUTPUT_INVALID',
      502
    );
  }
  if (isInvalidAIProviderResponse(error)) {
    return new AIError(
      'The AI provider returned an invalid response.',
      'AI_PROVIDER_RESPONSE_INVALID',
      502
    );
  }
  if (UnsupportedFunctionalityError.isInstance(error)
    || error instanceof UnsupportedModelVersionError) {
    return new AIError(
      'The selected AI model does not support this operation.',
      'AI_CAPABILITY_NOT_SUPPORTED',
      400,
    );
  }
  if (isTimeoutError(error)) {
    return new AIError('The AI request timed out.', 'AI_REQUEST_TIMEOUT', 504);
  }
  if (isAbortError(error)) {
    return new AIError('The AI request was aborted.', 'AI_REQUEST_ABORTED', 499);
  }
  if (abortSignal?.aborted) {
    return new AIError('The AI request was aborted.', 'AI_REQUEST_ABORTED', 499);
  }
  if (isInvalidAIRequestError(error)) {
    return new AIError(
      'AI request is invalid.',
      'AI_REQUEST_INVALID',
      400
    );
  }
  return new AIError(
    'AI provider request failed.',
    'AI_REQUEST_FAILED',
    502
  );
}

function isInvalidAIRequestError(error: unknown): boolean {
  return InvalidPromptError.isInstance(error)
    || InvalidArgumentError.isInstance(error)
    || InvalidDataContentError.isInstance(error)
    || InvalidMessageRoleError.isInstance(error)
    || InvalidToolApprovalError.isInstance(error)
    || InvalidToolApprovalSignatureError.isInstance(error)
    || ToolCallNotFoundForApprovalError.isInstance(error)
    || MissingToolResultsError.isInstance(error)
    || MessageConversionError.isInstance(error);
}

function isInvalidAIProviderResponse(error: unknown): boolean {
  return InvalidResponseDataError.isInstance(error)
    || InvalidStreamPartError.isInstance(error)
    || NoContentGeneratedError.isInstance(error)
    || NoImageGeneratedError.isInstance(error)
    || NoSpeechGeneratedError.isInstance(error)
    || NoTranscriptGeneratedError.isInstance(error)
    || NoVideoGeneratedError.isInstance(error)
    || InvalidToolInputError.isInstance(error)
    || NoSuchToolError.isInstance(error)
    || ToolCallRepairError.isInstance(error)
    || ToolChoiceViolationError.isInstance(error);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'AbortError' || error.name === 'ResponseAborted');
}

function messagesRequireVision(
  messages: readonly { readonly content: unknown }[] | undefined,
): boolean {
  if (!messages) return false;
  return messages.some((message) => {
    if (typeof message.content === 'string') return false;
    if (!Array.isArray(message.content)) return false;
    return message.content.some((part) => {
      if (part === null || typeof part !== 'object' || !('type' in part)) return false;
      if (part.type === 'image') return true;
      if (part.type !== 'file' && part.type !== 'reasoning-file') return false;
      if (!('mediaType' in part) || typeof part.mediaType !== 'string') return false;
      return part.mediaType === 'image' || part.mediaType.startsWith('image/');
    });
  });
}
