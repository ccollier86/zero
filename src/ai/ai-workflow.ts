/**
 * ai-workflow.ts
 *
 * Provides small helpers for using Zero's AI service inside durable workflow
 * step handlers. This file does not register workflows, persist workflow
 * state, expose routes, or own provider configuration.
 */

import type { ToolSet } from 'ai';

import type { StepContext, StepHandler } from '../workflows/types';
import { getAI } from './ai.plugin';
import { AIError } from './ai-errors';
import { normalizeAIProviderOptions } from './ai-provider-options';
import { snapshotAIHeaders, snapshotAIStringList, snapshotAITimeout } from './ai-request-snapshot';
import type {
  AIGenerateConversationRequest,
  AIMessage,
  AIMessageContent,
  AIRequestOptions,
  AITextResult,
} from './ai-types';

type MaybePromise<T> = T | Promise<T>;

interface AIWorkflowService {
  generateConversation(request: AIGenerateConversationRequest): Promise<AITextResult>;
}

export interface AIWorkflowHandlerOptions<TInput = unknown> extends AIRequestOptions {
  /** Optional service override for tests or custom dependency injection. */
  service?: AIWorkflowService | (() => AIWorkflowService | null | undefined);
  /** System prompt or a function that derives it from the workflow step. */
  system?: string | ((ctx: StepContext<TInput>) => MaybePromise<string | undefined>);
  /** Explicit messages or a function that derives them from the workflow step. */
  messages?: readonly AIMessage[] | ((ctx: StepContext<TInput>) => MaybePromise<readonly AIMessage[]>);
  /** User prompt/content or a function that derives it from the workflow step. */
  prompt?: AIMessageContent | ((ctx: StepContext<TInput>) => MaybePromise<AIMessageContent>);
  /** Optional tools passed to the selected model call. */
  tools?: ToolSet | ((ctx: StepContext<TInput>) => MaybePromise<ToolSet | undefined>);
  /** Optional tool selection policy passed to the selected model call. */
  toolChoice?: AIGenerateConversationRequest['toolChoice'];
  /** Return `result` for full AI SDK output; default returns generated text. */
  output?: 'text' | 'result';
}

/**
 * Create a durable workflow step handler that calls Zero AI.
 *
 * The selected provider/model comes from `options.model`, exactly like other
 * AI service calls. When `messages` and `prompt` are omitted, the handler sends
 * the workflow step input as a single user message.
 */
export function createAIWorkflowHandler<TInput = unknown>(
  options: AIWorkflowHandlerOptions<TInput>
): StepHandler {
  const {
    service: configuredService,
    system: configuredSystem,
    messages: configuredMessages,
    prompt: configuredPrompt,
    tools: configuredTools,
    toolChoice,
    output,
    ...requestOptions
  } = options;
  // Capture the declared request controls at handler construction, using the
  // same bounded snapshots as ordinary generation. Handler-only settings must
  // never become SDK request options, and async derivation must not race them.
  const request = {
    ...requestOptions,
    headers: snapshotAIHeaders(requestOptions.headers),
    timeout: snapshotAITimeout(requestOptions.timeout),
    stopSequences: snapshotAIStringList(requestOptions.stopSequences, 'AI stop sequences'),
    providerOptions: normalizeAIProviderOptions(requestOptions.providerOptions),
    metadata: { ...requestOptions.metadata },
  };
  const messageOptions = { messages: configuredMessages, prompt: configuredPrompt };
  return async (context) => {
    const ctx = context as StepContext<TInput>;
    const service = resolveWorkflowAIService(configuredService);
    const messages = await resolveWorkflowMessages(messageOptions, ctx);
    const system = await resolveMaybe(configuredSystem, ctx);
    const tools = await resolveMaybe(configuredTools, ctx);
    const abort = combineWorkflowAbortSignals(ctx.signal, request.abortSignal);

    try {
      // Prompt/tool derivation may yield. Revalidate at the external-effect
      // boundary so a revoked, cancelled, or stale attempt cannot start an AI
      // request with authority it no longer owns.
      abort.signal?.throwIfAborted();
      ctx.assertCurrentAuthority();
      const result = await service.generateConversation({
        ...request,
        system,
        messages,
        tools,
        toolChoice,
        abortSignal: abort.signal,
        metadata: {
          workflowInstanceId: ctx.instanceId,
          workflowStepIndex: ctx.stepIndex,
          ...request.metadata,
        },
      });

      return output === 'result' ? result : result.text;
    } finally {
      abort.dispose();
    }
  };
}

function combineWorkflowAbortSignals(
  workflow: AbortSignal | undefined,
  configured: AbortSignal | undefined,
): { signal: AbortSignal | undefined; dispose: () => void } {
  if (!workflow || workflow === configured) {
    return { signal: configured ?? workflow, dispose: () => undefined };
  }
  if (!configured) {
    return { signal: workflow, dispose: () => undefined };
  }

  const controller = new AbortController();
  const abortFromWorkflow = () => controller.abort(workflow.reason);
  const abortFromConfigured = () => controller.abort(configured.reason);

  if (workflow.aborted) abortFromWorkflow();
  else if (configured.aborted) abortFromConfigured();
  else {
    workflow.addEventListener('abort', abortFromWorkflow, { once: true });
    configured.addEventListener('abort', abortFromConfigured, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      workflow.removeEventListener('abort', abortFromWorkflow);
      configured.removeEventListener('abort', abortFromConfigured);
    },
  };
}

function resolveWorkflowAIService(
  service: AIWorkflowHandlerOptions['service']
): AIWorkflowService {
  const resolved = typeof service === 'function' ? service() : service ?? getAI();
  if (!resolved) {
    throw new AIError('AI is not enabled for this workflow handler.', 'AI_DISABLED', 500);
  }
  return resolved;
}

async function resolveWorkflowMessages<TInput>(
  options: Pick<AIWorkflowHandlerOptions<TInput>, 'messages' | 'prompt'>,
  ctx: StepContext<TInput>
): Promise<readonly AIMessage[]> {
  const explicitMessages = await resolveMaybe(options.messages, ctx);
  if (explicitMessages) return explicitMessages;

  const prompt = await resolveMaybe(options.prompt, ctx);
  return [
    {
      role: 'user',
      content: prompt ?? workflowValueToContent(ctx.input),
    },
  ];
}

async function resolveMaybe<TInput, TValue>(
  value: TValue | ((ctx: StepContext<TInput>) => MaybePromise<TValue>) | undefined,
  ctx: StepContext<TInput>
): Promise<TValue | undefined> {
  if (typeof value === 'function') {
    return (value as (ctx: StepContext<TInput>) => MaybePromise<TValue>)(ctx);
  }
  return value;
}

function workflowValueToContent(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
