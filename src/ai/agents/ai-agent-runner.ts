/**
 * ai-agent-runner.ts
 *
 * Executes one bounded ephemeral Zero agent with AI SDK 7 ToolLoopAgent. This
 * file owns run isolation and lifecycle coordination only; it does not resolve
 * app authorization or persist durable workflow state.
 */

import {
  ToolLoopAgent,
  stepCountIs,
  type GenerateTextResult,
  type LanguageModel,
  type OutputInterface,
  type StreamTextResult,
  type TimeoutConfiguration,
  type ToolLoopAgentSettings,
  type ToolSet,
} from 'ai';

import { AIError } from '../ai-errors';
import {
  prepareDirectAIModelExecution,
  type AIPreparedModelExecution,
  type AIPrepareModelExecution,
} from '../ai-model-execution';
import {
  createAIAgentApprovalConfiguration,
  hasAIAgentApprovalPolicy,
  resolveAIAgentApprovalSecret,
} from './ai-agent-approval';
import { AIAgentExecutionBudget } from './ai-agent-budget';
import { resolveAIAgentRunContexts } from './ai-agent-context';
import type { AIAgentDefinition } from './ai-agent-definition';
import { resolveAIAgentTimeout } from './ai-agent-limits';
import { emitAIAgentLifecycle } from './ai-agent-observability';
import { agentModelMessages, agentPromptArguments } from './ai-agent-prompt';
import {
  combineAIAgentAbortSignals,
  normalizeAIAgentRunError,
} from './ai-agent-run-control';
import type {
  AIAgentContext,
  AIAgentObserver,
  AIAgentPlatformCodeEmitter,
  AIAgentPrompt,
  AIAgentTimeout,
} from './ai-agent-types';
import {
  materializeAIAgentTools,
  type AIAgentToolSet,
  type AIAgentToolsContext,
  type MaterializedAIAgentTools,
} from './ai-agent-tool';

/** Options shared by all runs executed through one runner. */
export interface AIAgentRunnerOptions {
  readonly approvalSecret?: string | Uint8Array;
  readonly requireSignedApprovals?: boolean;
  readonly observer?: AIAgentObserver;
  readonly generateRunId?: () => string;
  /** Resolve Zero aliases/provider-qualified strings into concrete SDK models. */
  readonly resolveModel?: (reference: string) => LanguageModel;
  /** Preferred managed boundary for provider policy, downloads, and telemetry. */
  readonly prepareModelExecution?: AIPrepareModelExecution;
  readonly emitCode?: AIAgentPlatformCodeEmitter;
}

/** Input for one typed ephemeral run. */
export type AIAgentRunInput<
  RUNTIME_CONTEXT extends AIAgentContext,
  EXECUTION_CONTEXT,
  TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
> = AIAgentPrompt & {
  readonly runtimeContext: RUNTIME_CONTEXT;
  readonly toolsContext: AIAgentToolsContext<TOOLS>;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: AIAgentTimeout<keyof TOOLS & string>;
} & ([EXECUTION_CONTEXT] extends [undefined]
  ? { readonly executionContext?: EXECUTION_CONTEXT }
  : { readonly executionContext: EXECUTION_CONTEXT });

/** Framework-independent ephemeral runner for immutable definitions. */
export class AIAgentRunner {
  private readonly approvalSecret: string | Uint8Array | undefined;
  private readonly requireSignedApprovals: boolean;
  private readonly observer: AIAgentObserver | undefined;
  private readonly generateRunId: () => string;
  private readonly resolveModel: ((reference: string) => LanguageModel) | undefined;
  private readonly prepareModelExecution: AIPrepareModelExecution | undefined;
  private readonly emitCode: AIAgentPlatformCodeEmitter | undefined;

  constructor(options: AIAgentRunnerOptions = {}) {
    this.approvalSecret = resolveAIAgentApprovalSecret(options.approvalSecret);
    this.requireSignedApprovals = options.requireSignedApprovals ?? true;
    this.observer = options.observer;
    this.generateRunId = options.generateRunId ?? (() => crypto.randomUUID());
    this.resolveModel = options.resolveModel;
    this.prepareModelExecution = options.prepareModelExecution;
    this.emitCode = options.emitCode;
  }

  /** Execute a non-streaming run and return the native typed SDK 7 result. */
  async generate<
    RUNTIME_CONTEXT extends AIAgentContext,
    EXECUTION_CONTEXT,
    TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
    OUTPUT extends OutputInterface,
  >(
    definition: AIAgentDefinition<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS, OUTPUT>,
    input: AIAgentRunInput<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS>,
  ): Promise<GenerateTextResult<MaterializedAIAgentTools<TOOLS>, RUNTIME_CONTEXT, OUTPUT>> {
    const run = await this.prepareRun(definition, input);
    this.emit({ type: 'run.started', ...run.identity });
    try {
      const result = await run.agent.generate({
        ...agentPromptArguments(input),
        abortSignal: run.abortSignal,
        ...(run.timeout === undefined ? {} : { timeout: run.timeout }),
      });
      if (run.budget.exceeded) throw run.budget.exceeded;
      // Force SDK structured-output parsing before publishing completion.
      if (definition.output !== undefined) void result.output;
      run.prepared.complete({ usage: result.usage, toolNames: run.toolNames });
      this.emit({ type: 'run.completed', ...run.identity });
      return result;
    } catch (error) {
      const normalized = normalizeAIAgentRunError(error, run.abortSignal);
      run.prepared.fail(normalized);
      this.emit(normalized.code === 'AI_REQUEST_ABORTED'
        ? { type: 'run.cancelled', ...run.identity }
        : { type: 'run.failed', ...run.identity, error: normalized });
      throw normalized;
    } finally {
      run.dispose();
    }
  }

  /** Start a streaming run; its lifecycle settles with the SDK terminal reason. */
  async stream<
    RUNTIME_CONTEXT extends AIAgentContext,
    EXECUTION_CONTEXT,
    TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
    OUTPUT extends OutputInterface,
  >(
    definition: AIAgentDefinition<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS, OUTPUT>,
    input: AIAgentRunInput<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS>,
  ): Promise<StreamTextResult<MaterializedAIAgentTools<TOOLS>, RUNTIME_CONTEXT, OUTPUT>> {
    const run = await this.prepareRun(definition, input);
    this.emit({ type: 'run.started', ...run.identity });
    try {
      const result = await run.agent.stream({
        ...agentPromptArguments(input),
        abortSignal: run.abortSignal,
        ...(run.timeout === undefined ? {} : { timeout: run.timeout }),
      });
      const terminal = Promise.all([
        Promise.resolve(result.finishReason),
        Promise.resolve(result.usage),
        definition.output === undefined
          ? Promise.resolve(undefined)
          : Promise.resolve().then(() => result.output),
      ]);
      void terminal
        .then(([finishReason, usage]) => {
          if (run.budget.exceeded) {
            run.prepared.fail(run.budget.exceeded);
            this.emit({ type: 'run.failed', ...run.identity, error: run.budget.exceeded });
          } else if (finishReason === 'error') {
            const error = new AIError(
              'AI agent stream ended with an error.',
              'AI_AGENT_EXECUTION_FAILED',
              502,
            );
            run.prepared.fail(error);
            this.emit({
              type: 'run.failed',
              ...run.identity,
              error,
            });
          } else if (run.abortSignal.aborted) {
            run.prepared.fail(normalizeAIAgentRunError(run.abortSignal.reason, run.abortSignal));
            this.emit({ type: 'run.cancelled', ...run.identity });
          } else {
            run.prepared.complete({ usage, toolNames: run.toolNames });
            this.emit({ type: 'run.completed', ...run.identity });
          }
        })
        .catch((error: unknown) => {
          const normalized = normalizeAIAgentRunError(error, run.abortSignal);
          run.prepared.fail(normalized);
          this.emit(normalized.code === 'AI_REQUEST_ABORTED'
            ? { type: 'run.cancelled', ...run.identity }
            : { type: 'run.failed', ...run.identity, error: normalized });
        })
        .finally(run.dispose);
      return result;
    } catch (error) {
      const normalized = normalizeAIAgentRunError(error, run.abortSignal);
      run.prepared.fail(normalized);
      this.emit(normalized.code === 'AI_REQUEST_ABORTED'
        ? { type: 'run.cancelled', ...run.identity }
        : { type: 'run.failed', ...run.identity, error: normalized });
      run.dispose();
      throw normalized;
    }
  }

  private async prepareRun<
    RUNTIME_CONTEXT extends AIAgentContext,
    EXECUTION_CONTEXT,
    TOOLS extends AIAgentToolSet<RUNTIME_CONTEXT, EXECUTION_CONTEXT>,
    OUTPUT extends OutputInterface,
  >(
    definition: AIAgentDefinition<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS, OUTPUT>,
    input: AIAgentRunInput<RUNTIME_CONTEXT, EXECUTION_CONTEXT, TOOLS>,
  ) {
    const generatedRunId = this.generateRunId();
    const runId = typeof generatedRunId === 'string' ? generatedRunId.trim() : '';
    if (runId.length === 0
      || runId.length > 256
      || /[\u0000-\u001f\u007f-\u009f]/u.test(runId)) {
      throw new AIError(
        'AI agent run IDs must contain 1 through 256 printable characters.',
        'AI_AGENT_EXECUTION_FAILED',
        500,
      );
    }
    const identity = { name: definition.name, version: definition.version, runId } as const;
    const contexts = await resolveAIAgentRunContexts(
      definition,
      input.runtimeContext,
      input.toolsContext,
    );
    const hasApproval = hasAIAgentApprovalPolicy(definition.tools, definition.approval);
    if (hasApproval && this.requireSignedApprovals && this.approvalSecret === undefined) {
      throw new AIError(
        'AI agent tool approval requires a configured HMAC secret.',
        'AI_AGENT_APPROVAL_CONFIG_INVALID',
        500,
      );
    }

    const abortController = new AbortController();
    const combined = combineAIAgentAbortSignals(input.abortSignal, abortController.signal);
    let prepared: AIPreparedModelExecution | undefined;
    try {
      const budget = new AIAgentExecutionBudget(
        definition.limits,
        (error) => abortController.abort(error),
      );
      const executionContext = input.executionContext as EXECUTION_CONTEXT;
      const tools = materializeAIAgentTools({
        ...identity,
        tools: definition.tools,
        runtimeContext: contexts.runtimeContext,
        executionContext,
        budget,
        notify: (event) => {
          const { type, ...details } = event;
          this.emit({
            type: `tool.${type}`,
            ...identity,
            ...details,
          } as unknown as Parameters<AIAgentRunner['emit']>[0]);
        },
      });
      const approval = createAIAgentApprovalConfiguration({
        ...identity,
        tools: definition.tools,
        policy: definition.approval,
        executionContext,
      });
      const timeout = resolveAIAgentTimeout(
        input.timeout,
        Object.keys(definition.tools) as Array<keyof TOOLS & string>,
      );
      const toolNames = Object.keys(definition.tools);
      prepared = await this.prepareExecution(definition.model, {
        reference: typeof definition.model === 'string' ? definition.model : '',
        messages: agentModelMessages(input),
        toolNames,
        abortSignal: combined.signal,
        timeout: timeout as TimeoutConfiguration<ToolSet> | undefined,
        metadata: {
          agentName: definition.name,
          agentVersion: definition.version,
          agentRunId: runId,
        },
      });

      const lifecycle = prepared.lifecycle;
      const settings = {
        id: `${definition.name}@${definition.version}`,
        model: prepared.model,
        instructions: definition.instructions,
        tools,
        toolsContext: contexts.toolsContext as AIAgentToolsContext<TOOLS>,
        runtimeContext: contexts.runtimeContext as RUNTIME_CONTEXT,
        output: definition.output,
        toolApproval: approval,
        experimental_toolApprovalSecret: this.approvalSecret,
        stopWhen: stepCountIs(definition.limits.maxSteps),
        timeout: definition.timeout,
        maxRetries: definition.maxRetries,
        maxOutputTokens: definition.maxOutputTokens,
        temperature: definition.temperature,
        topP: definition.topP,
        topK: definition.topK,
        presencePenalty: definition.presencePenalty,
        frequencyPenalty: definition.frequencyPenalty,
        stopSequences: definition.stopSequences === undefined
          ? undefined
          : [...definition.stopSequences],
        seed: definition.seed,
        reasoning: definition.reasoning,
        providerOptions: definition.providerOptions,
        experimental_download: prepared.download,
        onStepStart: async (event: { readonly stepNumber: number } & Record<string, unknown>) => {
          budget.beginStep(event.stepNumber);
          this.emit({ type: 'step.started', ...identity, stepNumber: event.stepNumber });
          await lifecycle.onStepStart(event as never);
        },
        onLanguageModelCallStart: lifecycle.onLanguageModelCallStart,
        onLanguageModelCallEnd: lifecycle.onLanguageModelCallEnd,
        onToolExecutionStart: lifecycle.onToolExecutionStart,
        onToolExecutionEnd: lifecycle.onToolExecutionEnd,
        onStepEnd: lifecycle.onStepEnd,
      } as unknown as ToolLoopAgentSettings<
        never,
        MaterializedAIAgentTools<TOOLS>,
        RUNTIME_CONTEXT,
        OUTPUT
      >;
      const agent = new ToolLoopAgent<
        never,
        MaterializedAIAgentTools<TOOLS>,
        RUNTIME_CONTEXT,
        OUTPUT
      >(settings);

      return {
        agent,
        abortSignal: combined.signal,
        budget,
        identity,
        timeout,
        dispose: combined.dispose,
        prepared,
        toolNames,
      };
    } catch (error) {
      prepared?.fail(error);
      combined.dispose();
      throw error;
    }
  }

  private emit(event: Parameters<typeof emitAIAgentLifecycle>[0]): void {
    emitAIAgentLifecycle(event, this.observer, this.emitCode);
  }

  private resolveAgentModel(model: LanguageModel | string): LanguageModel {
    if (typeof model !== 'string') return model;
    if (!this.resolveModel) {
      throw new AIError(
        'AI agent model references require a Zero model resolver.',
        'AI_MODEL_NOT_CONFIGURED',
        503,
      );
    }
    return this.resolveModel(model);
  }

  private async prepareExecution(
    model: LanguageModel | string,
    request: Parameters<AIPrepareModelExecution>[0],
  ) {
    if (typeof model === 'string' && this.prepareModelExecution) {
      return await this.prepareModelExecution(request);
    }
    return prepareDirectAIModelExecution({
      model: this.resolveAgentModel(model),
      abortSignal: request.abortSignal,
      timeout: request.timeout,
      emitCode: this.emitCode,
    });
  }
}
