/**
 * workflow-start-coordinator.ts
 *
 * Owns workflow start selection, execution-authority capture, and atomic run
 * creation for the WorkflowService facade. It coordinates existing graph and
 * legacy factories; it does not own runtime disposal or HTTP authentication.
 */

import {
  serviceDataTenantId,
  type ServiceDataScope,
} from '../auth/service-data-scope';
import { AuthError, type AuthContext } from '../auth/types';
import { OBS_CODES } from '../observability/codes';
import {
  canAccessWorkflowDefinition,
  workflowAccessPrincipalFromExecutionIdentity,
} from './workflow-access';
import { WorkflowError, workflowNotFound } from './workflow-error';
import {
  createSystemAuthority,
  scopeFromIdentity,
  type WorkflowActorExecutionAuthority,
  type WorkflowExecutionAuthorityProvider,
  type WorkflowPersistedExecutionAuthority,
  type WorkflowSystemExecutionOptions,
} from './workflow-execution-authority';
import type { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import type { WorkflowGraphRuntime } from './workflow-graph-runtime';
import type { WorkflowInstanceFactory } from './workflow-instance-factory';
import type { WorkflowObservability } from './workflow-observability';
import type { WorkflowRegistry } from './workflow-registry';
import {
  isWorkflowServiceDataScope,
  type WorkflowScopeBoundary,
} from './workflow-scope-boundary';
import {
  validateWorkflowStartOptions,
  type WorkflowStartOptions,
} from './workflow-start-options';
import { tryStartWorkflowGraph } from './workflow-start-router';

/** Secret-free captured actor authority plus its final writer-lock fence. */
export interface WorkflowCapturedActorAuthorityFence {
  readonly authority: WorkflowActorExecutionAuthority;
  readonly assertCurrentAuthority: () => void;
}

/** Lifecycle hooks retained by the stable WorkflowService facade. */
export interface WorkflowStartCoordinatorHooks {
  beginOperation(): void;
  advance(instanceId: string): Promise<void>;
}

/** Create graph or legacy runs under one exact, durable execution authority. */
export class WorkflowStartCoordinator {
  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly graph: WorkflowGraphRuntime,
    private readonly instanceFactory: WorkflowInstanceFactory,
    private readonly authority: WorkflowExecutionAuthorityGate,
    private readonly authorityProvider: WorkflowExecutionAuthorityProvider | null,
    private readonly scopes: WorkflowScopeBoundary,
    private readonly observability: WorkflowObservability,
    private readonly hooks: WorkflowStartCoordinatorHooks,
  ) {}

  /** Start from the trusted standalone compatibility surface. */
  async startCompatibility(
    name: string,
    input: unknown,
    startedBy: string | null,
    scopeOrOptions: ServiceDataScope | WorkflowStartOptions,
    explicitOptions: WorkflowStartOptions = {},
  ): Promise<string> {
    if (this.authorityProvider) {
      throw new WorkflowError(
        'Managed workflow execution requires runAsActor() or runAsSystem()',
        'WORKFLOW_AUTHORITY_REQUIRED',
        500,
      );
    }
    const { scope, options } = this.resolveCompatibilityStart(
      scopeOrOptions,
      explicitOptions,
    );
    const authority = createSystemAuthority({
      principal: 'legacy:workflow-service',
      reason: 'Compatibility start() call on a trusted standalone workflow service',
      scope,
      legacyCompatibility: true,
    });
    return this.startWithAuthority(name, input, startedBy, authority, options);
  }

  /** Start under the exact live Guardian authority of an authenticated actor. */
  async startAsActor(
    name: string,
    input: unknown,
    context: AuthContext,
    options: WorkflowStartOptions,
    assertCurrentAuthority?: () => void,
  ): Promise<string> {
    const authority = this.authorityProvider?.captureActor(context) ?? null;
    if (!authority) {
      throw new AuthError(
        'Authorization changed before the workflow could start',
        'AUTH_STATE_CHANGED',
        409,
      );
    }
    return this.startWithAuthority(
      name,
      input,
      authority.identity.userId,
      authority,
      options,
      assertCurrentAuthority,
    );
  }

  /** Capture an actor authority and a final assertion for a later mutation. */
  captureActorAuthorityFence(context: AuthContext): WorkflowCapturedActorAuthorityFence {
    const provider = this.authorityProvider;
    const authority = provider?.captureActor(context) ?? null;
    if (!provider || !authority) {
      throw new AuthError(
        'Authorization changed before the workflow action could start',
        'AUTH_STATE_CHANGED',
        409,
      );
    }
    return Object.freeze({
      authority,
      assertCurrentAuthority: () => this.authority.assertActorCurrent(authority),
    });
  }

  /** Capture only the commit-time actor assertion for an external mutation. */
  captureActorAuthorityAssertion(context: AuthContext): () => void {
    return this.captureActorAuthorityFence(context).assertCurrentAuthority;
  }

  /** Start through the explicit privileged system-authority surface. */
  async startAsSystem(
    name: string,
    input: unknown,
    system: WorkflowSystemExecutionOptions,
    options: WorkflowStartOptions,
  ): Promise<string> {
    const scope = this.scopes.requireScope(system.scope);
    const authority = createSystemAuthority({ ...system, scope });
    return this.startWithAuthority(name, input, null, authority, options);
  }

  private async startWithAuthority(
    name: string,
    input: unknown,
    startedBy: string | null,
    authority: WorkflowPersistedExecutionAuthority,
    options: WorkflowStartOptions,
    assertCurrentAuthority?: () => void,
  ): Promise<string> {
    this.hooks.beginOperation();
    const boundary = scopeFromIdentity(authority.identity);
    this.scopes.assertCompatible(boundary);
    const startOptions = validateWorkflowStartOptions(options);
    const principal = workflowAccessPrincipalFromExecutionIdentity(authority.identity);
    const graphInstanceId = await tryStartWorkflowGraph({
      graph: this.graph,
      registry: this.registry,
      name,
      workflowInput: input,
      startedBy,
      authority,
      principal,
      options: startOptions,
      assertCurrentAuthority,
    });
    if (graphInstanceId) return graphInstanceId;
    const compiled = this.registry.getCompiledWorkflow(name);
    if (!compiled || !canAccessWorkflowDefinition(compiled, 'start', principal)) {
      throw workflowNotFound();
    }
    if (startOptions.initialMemory !== undefined || startOptions.memoryLimits !== undefined) {
      throw new WorkflowError(
        'Private memory options are available only to graph workflows',
        'WORKFLOW_REQUEST_INVALID',
        422,
      );
    }
    const created = this.instanceFactory.create(name, input, startedBy, {
      tenantId: serviceDataTenantId(boundary),
      onCreate: (instanceId) => {
        assertCurrentAuthority?.();
        this.authority.insertCurrent(
          instanceId,
          authority,
          serviceDataTenantId(boundary),
        );
        this.graph.assertRegisteredNamespaceCurrent(name, authority);
      },
    });
    this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_INSTANCE_STARTED, {
      metadata: { instanceId: created.instanceId, name: created.name, startedBy },
    });
    await this.hooks.advance(created.instanceId);
    return created.instanceId;
  }

  private resolveCompatibilityStart(
    value: ServiceDataScope | WorkflowStartOptions,
    explicitOptions: WorkflowStartOptions,
  ): { scope: ServiceDataScope; options: WorkflowStartOptions } {
    if (isWorkflowServiceDataScope(value)) {
      return {
        scope: this.scopes.requireScope(value),
        options: explicitOptions,
      };
    }
    if (Object.keys(explicitOptions).length > 0) {
      throw new WorkflowError(
        'Standalone workflow start options must follow an explicit trusted scope',
        'WORKFLOW_REQUEST_INVALID',
        422,
      );
    }
    return { scope: this.scopes.requireScope(undefined), options: value };
  }
}
