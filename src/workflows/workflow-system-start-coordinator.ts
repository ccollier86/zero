/** Atomic privileged start orchestration; durable creation precedes all application execution. */
import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { canAccessWorkflowDefinition, workflowAccessPrincipalFromExecutionIdentity } from './workflow-access';
import { createSystemAuthority } from './workflow-execution-authority';
import type { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import { WorkflowError, workflowNotFound } from './workflow-error';
import type { WorkflowGraphRuntime } from './workflow-graph-runtime';
import type { WorkflowInstanceFactory } from './workflow-instance-factory';
import type { WorkflowObservability } from './workflow-observability';
import type { WorkflowRegistry } from './workflow-registry';
import type { WorkflowRepository } from './workflow-repository';
import type { WorkflowScopeBoundary } from './workflow-scope-boundary';
import type { WorkflowStartCoordinatorHooks } from './workflow-start-coordinator';
import type { WorkflowStartOptions } from './workflow-start-options';
import { tryCreateWorkflowGraph } from './workflow-start-router';
import { WorkflowSystemStartReceiptStore } from './workflow-system-start-receipt-store';
import {
  prepareWorkflowSystemStart, requireWorkflowSystemStartKey, workflowSystemStartHash,
  type WorkflowSystemStartOptions, type WorkflowSystemStartResult, type WorkflowSystemStartMutation,
} from './workflow-system-start-contract';

/** One permanent start command per exact source scope, system principal, and effect key. */
export class WorkflowSystemStartCoordinator {
  private readonly receipts: WorkflowSystemStartReceiptStore;
  constructor(private readonly db: ReactiveDB, private readonly registry: WorkflowRegistry, private readonly graph: WorkflowGraphRuntime,
    private readonly instances: WorkflowInstanceFactory, private readonly repository: WorkflowRepository,
    private readonly authority: WorkflowExecutionAuthorityGate, private readonly scopes: WorkflowScopeBoundary,
    private readonly hooks: WorkflowStartCoordinatorHooks, private readonly observability: WorkflowObservability) {
    this.receipts = new WorkflowSystemStartReceiptStore(db, authority.store);
  }

  async start(name: string, input: unknown, system: WorkflowSystemStartOptions,
    options: WorkflowStartOptions = {}, mutation: WorkflowSystemStartMutation = {}): Promise<WorkflowSystemStartResult> {
    // This async API cannot acknowledge an unrelated caller's unfinished root
    // transaction. Check only Bun's transaction state; all writes below still
    // flow through the owner-fenced ReactiveDB repository.
    if (this.db.getRawDatabase().inTransaction) {
      throw new WorkflowError('Workflow system starts must run outside a database transaction', 'WORKFLOW_REQUEST_INVALID', 422);
    }
    this.hooks.beginOperation();
    const key = requireWorkflowSystemStartKey(system?.idempotencyKey);
    const scope = this.scopes.requireScope(system.scope);
    const authority = createSystemAuthority({ principal: system.principal, reason: system.reason, scope });
    this.scopes.assertCompatible(scope);
    const command = prepareWorkflowSystemStart(name, input, options);
    const identity = Object.freeze({ scopeKind: scope.scopeKind, scopeId: scope.scopeId, tenantId: scope.tenantId,
      principal: authority.identity.principal, idempotencyKey: key });
    const requestFingerprint = workflowSystemStartHash([1, name, command.inputJson, command.optionsJson, authority.identity]);
    const metadata = { name, principal: identity.principal, scopeKind: scope.scopeKind };
    let fenceFailed = false;
    const fence = () => {
      try {
        const returned: unknown = mutation.assertCurrentAuthority?.();
        if (returned !== undefined) {
          // Native async functions are assignable to () => void in TypeScript.
          // Consume their rejection without reading an authored `then` getter;
          // the asynchronous result never grants commit authority.
          try { Promise.prototype.then.call(returned, undefined, () => {}); } catch {}
          throw new WorkflowError('Workflow start authority fence must be synchronous', 'WORKFLOW_CONFIG_INVALID', 500);
        }
      } catch (error) { fenceFailed = true; throw error; }
    };
    let result: WorkflowSystemStartResult;
    try {
      result = this.repository.transaction(() => {
        fence();
        const prior = this.receipts.lookup(identity, requestFingerprint);
        if (prior) {
          fence();
          this.receipts.validateInstance(prior.instanceId);
          this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_SYSTEM_START_REPLAYED, { metadata: { ...metadata, instanceId: prior.instanceId } });
          return prior;
        }
        const principal = workflowAccessPrincipalFromExecutionIdentity(authority.identity);
        let instanceId = tryCreateWorkflowGraph({ graph: this.graph, registry: this.registry, name,
          workflowInput: command.input, startedBy: null, authority, principal, options: command.options,
          assertCurrentAuthority: fence });
        if (!instanceId) {
          const compiled = this.registry.getCompiledWorkflow(name);
          if (!compiled || !canAccessWorkflowDefinition(compiled, 'start', principal)) throw workflowNotFound();
          if (command.options.initialMemory !== undefined || command.options.memoryLimits !== undefined) {
            throw new WorkflowError('Private memory options are available only to graph workflows', 'WORKFLOW_REQUEST_INVALID', 422);
          }
          instanceId = this.instances.create(name, command.input, null, { tenantId: scope.tenantId, onCreate: (id) => {
            fence(); this.authority.insertCurrent(id, authority, scope.tenantId);
            this.graph.assertRegisteredNamespaceCurrent(name, authority);
          } }).instanceId;
          this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_INSTANCE_STARTED, { metadata: { instanceId, name, startedBy: null } });
        }
        const instance = this.repository.getInstance(instanceId);
        if (!instance) throw new WorkflowError('Workflow start did not create durable state', 'WORKFLOW_STATE_INVALID', 500);
        const created = this.receipts.insert(identity, requestFingerprint, instance, authority);
        fence();
        this.receipts.validateInstance(created.instanceId);
        this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_SYSTEM_START_CREATED, { metadata: { ...metadata, instanceId } });
        return created;
      });
    } catch (error) {
      if (fenceFailed) throw error;
      if (error instanceof WorkflowError) {
        if (error.code === 'WORKFLOW_START_IDEMPOTENCY_CONFLICT') this.observability.emitNow(OBS_CODES.WORKFLOW_SYSTEM_START_CONFLICT, { metadata });
        throw error;
      }
      this.observability.emitNow(OBS_CODES.WORKFLOW_SYSTEM_START_FAILED, { metadata });
      throw new WorkflowError('Workflow system start failed', 'WORKFLOW_INTERNAL_ERROR', 500);
    }
    // Committed-change listeners may perform reentrant trusted writes before
    // transaction() returns. Never execute a command whose pinned snapshot was
    // altered either by the final fence or by a publication callback.
    this.receipts.validateInstance(result.instanceId);
    if (this.repository.getInstance(result.instanceId)?.status === 'running') await this.hooks.advance(result.instanceId);
    return result;
  }

  /** Verify receipts before ordinary recovery drives their still-pending runs. */
  validateRecovery(): void {
    this.receipts.validateRecovery();
  }
}
