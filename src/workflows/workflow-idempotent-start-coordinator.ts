/** Atomic actor/SYSTEM start orchestration; exact sealed authority and durable receipts precede application execution. */
import type { ReactiveDB } from '../sync/reactive-db';
import { OBS_CODES } from '../observability/codes';
import { canAccessWorkflowDefinition, workflowAccessPrincipalFromExecutionIdentity } from './workflow-access';
import { createSystemAuthority } from './workflow-execution-authority';
import { scopeFromIdentity, type WorkflowActorExecutionAuthority, type WorkflowPersistedExecutionAuthority } from './workflow-execution-authority';
import { workflowActorStartPrincipal } from './workflow-actor-start-contract';
import { assertWorkflowSynchronousAuthority } from './workflow-authority-assertion';
import type { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import { WorkflowError, workflowNotFound } from './workflow-error';
import type { WorkflowGraphRuntime } from './workflow-graph-runtime';
import type { WorkflowInstanceFactory } from './workflow-instance-factory';
import type { WorkflowObservability } from './workflow-observability';
import type { WorkflowRegistry } from './workflow-registry';
import type { WorkflowRepository } from './workflow-repository';
import type { WorkflowScopeBoundary } from './workflow-scope-boundary';
import type { WorkflowCommitDispatchHooks } from './workflow-commit-dispatch-hooks';
import type { WorkflowStartOptions } from './workflow-start-options';
import { tryCreateWorkflowGraph } from './workflow-start-router';
import { WorkflowStartReceiptStore } from './workflow-start-receipt-store';
import {
  prepareWorkflowSystemStart, requireWorkflowSystemStartKey, workflowSystemStartHash,
  type WorkflowSystemStartOptions, type WorkflowSystemStartResult, type WorkflowSystemStartMutation,
} from './workflow-system-start-contract';

/** One permanent start command per exact source scope, system principal, and effect key. */
export class WorkflowIdempotentStartCoordinator {
  private readonly receipts: WorkflowStartReceiptStore;
  private readonly actorReceipts: WorkflowStartReceiptStore;
  constructor(private readonly db: ReactiveDB, private readonly registry: WorkflowRegistry, private readonly graph: WorkflowGraphRuntime,
    private readonly instances: WorkflowInstanceFactory, private readonly repository: WorkflowRepository,
    private readonly authority: WorkflowExecutionAuthorityGate, private readonly scopes: WorkflowScopeBoundary,
    private readonly hooks: WorkflowCommitDispatchHooks, private readonly observability: WorkflowObservability) {
    this.receipts = new WorkflowStartReceiptStore(db, authority.store);
    this.actorReceipts = new WorkflowStartReceiptStore(db, authority.store, 'actor');
  }

  async start(name: string, input: unknown, system: WorkflowSystemStartOptions,
    options: WorkflowStartOptions = {}, mutation: WorkflowSystemStartMutation = {}, deferred = false): Promise<WorkflowSystemStartResult> {
    const key = requireWorkflowSystemStartKey(system?.idempotencyKey);
    const scope = this.scopes.requireScope(system.scope);
    const authority = createSystemAuthority({ principal: system.principal, reason: system.reason, scope });
    return this.startAuthorized(name, input, authority, key, options, mutation, null, deferred);
  }

  /** Actor and SYSTEM commands share atomic creation mechanics, never their authority or receipt namespace. */
  async startActor(name: string, input: unknown, actor: WorkflowActorExecutionAuthority, key: string,
    options: WorkflowStartOptions, bindingJson: string | null, mutation: WorkflowSystemStartMutation): Promise<WorkflowSystemStartResult> {
    return this.startAuthorized(name, input, actor, requireWorkflowSystemStartKey(key), options, mutation, bindingJson);
  }

  /** Reconcile a lost acknowledgement without executing work or reusing SYSTEM authority. */
  lookupActor(actor: WorkflowActorExecutionAuthority, key: string, mutation: WorkflowSystemStartMutation): WorkflowSystemStartResult | null {
    this.hooks.beginOperation();
    if (this.db.getRawDatabase().inTransaction) throw new WorkflowError('Workflow start lookup requires an independent transaction', 'WORKFLOW_REQUEST_INVALID', 422);
    const scope = scopeFromIdentity(actor.identity);
    this.scopes.assertCompatible(scope);
    return this.repository.transaction(() => {
      assertWorkflowSynchronousAuthority(mutation.assertCurrentAuthority);
      this.authority.assertActorCurrent(actor);
      const result = this.actorReceipts.lookup({ ...scope, principal: workflowActorStartPrincipal(actor), idempotencyKey: requireWorkflowSystemStartKey(key) }, undefined,
        original => { if (original.kind !== 'actor') throw new WorkflowError('Invalid actor receipt', 'WORKFLOW_STATE_INVALID', 500); this.authority.assertActorCurrent(original); });
      assertWorkflowSynchronousAuthority(mutation.assertCurrentAuthority);
      this.authority.assertActorCurrent(actor);
      return result;
    });
  }

  private async startAuthorized(name: string, input: unknown, authority: WorkflowPersistedExecutionAuthority, key: string,
    options: WorkflowStartOptions, mutation: WorkflowSystemStartMutation, bindingJson: string | null = null, deferred = false): Promise<WorkflowSystemStartResult> {
    // This async API cannot acknowledge an unrelated caller's unfinished root
    // transaction. Check only Bun's transaction state; all writes below still
    // flow through the owner-fenced ReactiveDB repository.
    if (this.db.getRawDatabase().inTransaction) {
      throw new WorkflowError('Workflow idempotent starts must run outside a database transaction', 'WORKFLOW_REQUEST_INVALID', 422);
    }
    this.hooks.beginOperation();
    const scope = scopeFromIdentity(authority.identity);
    this.scopes.assertCompatible(scope);
    const command = prepareWorkflowSystemStart(name, input, options);
    const identity = Object.freeze({ scopeKind: scope.scopeKind, scopeId: scope.scopeId, tenantId: scope.tenantId,
      principal: authority.kind === 'system' ? authority.identity.principal : workflowActorStartPrincipal(authority), idempotencyKey: key });
    const requestFingerprint = workflowSystemStartHash(authority.kind === 'system'
      ? [1, name, command.inputJson, command.optionsJson, authority.identity]
      : [1, name, command.inputJson, command.optionsJson, authority.identity, bindingJson]);
    const receipts = authority.kind === 'system' ? this.receipts : this.actorReceipts;
    const codes = authority.kind === 'system'
      ? { created: OBS_CODES.WORKFLOW_SYSTEM_START_CREATED, replayed: OBS_CODES.WORKFLOW_SYSTEM_START_REPLAYED, conflict: OBS_CODES.WORKFLOW_SYSTEM_START_CONFLICT, failed: OBS_CODES.WORKFLOW_SYSTEM_START_FAILED }
      : { created: OBS_CODES.WORKFLOW_ACTOR_START_CREATED, replayed: OBS_CODES.WORKFLOW_ACTOR_START_REPLAYED, conflict: OBS_CODES.WORKFLOW_ACTOR_START_CONFLICT, failed: OBS_CODES.WORKFLOW_ACTOR_START_FAILED };
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
        if (authority.kind === 'actor') this.authority.assertActorCurrent(authority);
      } catch (error) { fenceFailed = true; throw error; }
    };
    let result: WorkflowSystemStartResult;
    try {
      result = this.repository.transaction(() => {
        fence();
        const prior = receipts.lookup(identity, requestFingerprint, original => {
          if (original.kind === 'actor') this.authority.assertActorCurrent(original);
        });
        if (prior) {
          fence();
          receipts.validateInstance(prior.instanceId);
          this.observability.emitAfterCommit(codes.replayed, { metadata: { ...metadata, instanceId: prior.instanceId } });
          return prior;
        }
        receipts.assertCapacity(identity);
        const principal = workflowAccessPrincipalFromExecutionIdentity(authority.identity);
        let instanceId = tryCreateWorkflowGraph({ graph: this.graph, registry: this.registry, name,
          workflowInput: command.input, startedBy: authority.kind === 'actor' ? authority.identity.userId : null, authority, principal, options: command.options,
          assertCurrentAuthority: fence });
        if (!instanceId) {
          const compiled = this.registry.getCompiledWorkflow(name);
          if (!compiled || !canAccessWorkflowDefinition(compiled, 'start', principal)) throw workflowNotFound();
          if (command.options.initialMemory !== undefined || command.options.memoryLimits !== undefined) {
            throw new WorkflowError('Private memory options are available only to graph workflows', 'WORKFLOW_REQUEST_INVALID', 422);
          }
          instanceId = this.instances.create(name, command.input, authority.kind === 'actor' ? authority.identity.userId : null, { tenantId: scope.tenantId, onCreate: (id) => {
            fence(); this.authority.insertCurrent(id, authority, scope.tenantId);
            this.graph.assertRegisteredNamespaceCurrent(name, authority);
          } }).instanceId;
          this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_INSTANCE_STARTED, { metadata: { instanceId, name, startedBy: authority.kind === 'actor' ? authority.identity.userId : null } });
        }
        const instance = this.repository.getInstance(instanceId);
        if (!instance) throw new WorkflowError('Workflow start did not create durable state', 'WORKFLOW_STATE_INVALID', 500);
        const created = receipts.insert(identity, requestFingerprint, instance, authority);
        fence();
        receipts.validateInstance(created.instanceId);
        this.observability.emitAfterCommit(codes.created, { metadata: { ...metadata, instanceId } });
        return created;
      });
    } catch (error) {
      if (fenceFailed) throw error;
      if (error instanceof WorkflowError) {
        if (error.code === 'WORKFLOW_START_IDEMPOTENCY_CONFLICT') this.observability.emitNow(codes.conflict, { metadata });
        throw error;
      }
      this.observability.emitNow(codes.failed, { metadata });
      throw new WorkflowError(`Workflow ${authority.kind} start failed`, 'WORKFLOW_INTERNAL_ERROR', 500);
    }
    // Committed-change listeners may perform reentrant trusted writes before
    // transaction() returns. Never execute a command whose pinned snapshot was
    // altered either by the final fence or by a publication callback.
    receipts.validateInstance(result.instanceId);
    if (this.repository.getInstance(result.instanceId)?.status === 'running') {
      if (deferred) this.hooks.dispatch(result.instanceId);
      else await this.hooks.advance(result.instanceId);
    }
    return result;
  }

  /** Verify receipts before ordinary recovery drives their still-pending runs. */
  validateRecovery(): void {
    this.receipts.validateRecovery();
    this.actorReceipts.validateRecovery();
  }
}
