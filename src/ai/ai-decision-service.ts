/** App-local native decision facade. Policies and permitted actions remain application-owned. */
import { AIError } from './ai-errors';
import { resolveAIModelReference } from './ai-model-aliases';
import { emitAIModelAliasUnresolved } from './ai-observability';
import type { AIRegistry, ResolvedAIModel } from './ai-registry';
import { startAIRequestTelemetry } from './ai-request-telemetry';
import { createDecisionDeadline } from './ai-decision-deadline';
import { prepareDecisionRequest } from './ai-decision-validation';
import { parseDecisionResponse, invalidDecisionResponse } from './ai-decision-response';
import { AIDecision, type AIDecisionAnswers, type AIDecisionQuestions, type AIDecisionRequest, type AIDecisionResult } from './ai-decision-types';
import type { NativeDecisionProvider } from './ai-decision-provider';
import type { AIExecutionAuditSpan } from './ai-execution-audit';

export interface AIDecisionService {
  /** Evaluate independent typed questions together, with inferred answer labels. */
  evaluate<const Questions extends AIDecisionQuestions>(request: AIDecisionRequest<Questions>): Promise<AIDecisionResult<Questions>>;
  /** Convenience builders; identical to the exported AIDecision helpers. */
  readonly choice: typeof AIDecision.choice;
  readonly score: typeof AIDecision.score;
  readonly yesNo: typeof AIDecision.yesNo;
  /** Retire this owner and cancel its native requests. Managed AI plugins call this during cleanup. */
  dispose(): void;
}

export function createAIDecisionService(registry: AIRegistry, aliases: Record<string, string>): AIDecisionService {
  const ownedAliases: Record<string, string> = Object.freeze(Object.assign(Object.create(null), aliases));
  const executions = new Set<AbortController>();
  let disposed = false;
  return Object.freeze({
    ...AIDecision,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of executions) controller.abort();
      executions.clear();
    },
    async evaluate<const Questions extends AIDecisionQuestions>(request: AIDecisionRequest<Questions>): Promise<AIDecisionResult<Questions>> {
      if (disposed) throw new AIError('AI decision service has been retired.', 'AI_DISABLED', 503);
      const resolved = resolveDecisionModel(registry, ownedAliases, request.model);
      const telemetry = startAIRequestTelemetry(resolved, 'decisions', request.metadata);
      let deadline: ReturnType<typeof createDecisionDeadline> | undefined;
      let execution: AbortController | undefined;
      let audit: AIExecutionAuditSpan | undefined, dispatched = false;
      const startedAt = Date.now();
      try {
        const prepared = prepareDecisionRequest(request, resolved.reference.modelId, resolved.provider.type as 'jev' | 'laya');
        if (prepared.locality === 'local-only' && resolved.model.locality !== 'local') {
          throw new AIError('AI decision request requires an explicitly designated local provider.', 'AI_CAPABILITY_NOT_SUPPORTED', 400);
        }
        if (disposed) throw new AIError('AI decision service has been retired.', 'AI_DISABLED', 503);
        execution = new AbortController();
        executions.add(execution);
        const signal = request.abortSignal ? AbortSignal.any([request.abortSignal, execution.signal]) : execution.signal;
        deadline = createDecisionDeadline(prepared.timeoutMs, signal);
        deadline.assertCurrent();
        resolved.model.assertInputFits(prepared);
        deadline.assertCurrent();
        audit = registry.audit?.prepare({ capability: 'decisions', providerId: resolved.provider.id, model: resolved.reference.resolved })?.();
        if (audit) { await audit.admit(); audit.assertCurrent(); }
        deadline.assertCurrent(); dispatched = true;
        const raw = await resolved.model.evaluate(prepared.body, prepared.maxRetries, deadline);
        const result = parseDecisionResponse(raw, prepared.questions);
        if (resolved.provider.type === 'jev' && result.usage === null) throw invalidDecisionResponse();
        const provenance = Object.freeze({
          providerId: resolved.provider.id, providerType: resolved.provider.type as 'jev' | 'laya',
          requestedModel: resolved.reference.requested, resolvedModel: resolved.reference.resolved,
          locality: resolved.model.locality, ...(prepared.contract === undefined ? {} : { contract: prepared.contract }),
          durationMs: Math.max(0, Date.now() - startedAt),
        });
        deadline.assertCurrent();
        await audit?.finish('completed'); audit?.assertCurrent(); deadline.assertCurrent();
        telemetry.complete({ usage: result.usage ?? undefined });
        return Object.freeze({ ...result, answers: result.answers as AIDecisionAnswers<Questions>, provenance,
          inputCoverage: result.inputCoverage as AIDecisionResult<Questions>['inputCoverage'] });
      } catch (error) {
        if (dispatched) await audit?.finish('unknown');
        const normalized = error instanceof AIError ? error : new AIError('AI decision evaluation failed.', 'AI_REQUEST_FAILED', 502);
        telemetry.fail(normalized); throw normalized;
      } finally {
        deadline?.dispose();
        if (execution) executions.delete(execution);
      }
    },
  });
}

function resolveDecisionModel(registry: AIRegistry, aliases: Readonly<Record<string, string>>, requested?: string): ResolvedAIModel<NativeDecisionProvider> {
  try {
    if (requested !== undefined && (typeof requested !== 'string' || requested.length > 512 || /[\x00-\x1f]/.test(requested))) {
      throw new AIError('AI decision model reference is invalid.', 'AI_REQUEST_INVALID', 400);
    }
    const reference = resolveAIModelReference(requested, aliases, 'decisions');
    const provider = Object.hasOwn(registry.providers, reference.providerId) ? registry.providers[reference.providerId] : undefined;
    if (!provider) throw new AIError('AI decision provider is not configured.', 'AI_PROVIDER_NOT_CONFIGURED', 400);
    if (!provider.active) throw new AIError('AI decision provider is not active.', 'AI_PROVIDER_NOT_ACTIVE', 503);
    const model = registry.decisionProviders?.[provider.id];
    if (!model || !provider.capabilities.decisions) throw new AIError('AI provider does not support native decisions.', 'AI_CAPABILITY_NOT_SUPPORTED', 400);
    return { reference, provider, model, emitCode: registry.emitCode };
  } catch (error) {
    emitAIModelAliasUnresolved({ requestedModel: requested ?? 'decisions', capability: 'decisions',
      reason: error instanceof AIError ? error.code : 'AI_MODEL_NOT_CONFIGURED' }, registry.emitCode);
    throw error;
  }
}
