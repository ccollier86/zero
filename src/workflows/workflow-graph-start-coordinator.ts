/**
 * Atomic graph-workflow start coordination.
 *
 * Resolves the executable definition, enforces start access, pins the exact
 * version, creates the initial durable graph state, and advances the new run.
 */

import { OBS_CODES } from '../observability/codes';
import type { CompiledWorkflowDefinition } from './workflow-compiler';
import {
  canAccessWorkflowDefinition,
  freezeWorkflowAccessPolicy,
  type WorkflowAccessPrincipal,
} from './workflow-access';
import type { WorkflowDefinitionVersionStore } from './workflow-definition-version-store';
import type {
  ResolvedWorkflowDefinitionVersion,
  WorkflowDefinitionStartSelection,
} from './workflow-definition-version-types';
import { workflowDefinitionScopeFromTenantId } from './workflow-definition-scope';
import { WorkflowError, workflowNotFound } from './workflow-error';
import type { WorkflowPersistedExecutionAuthority } from './workflow-execution-authority';
import type { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import type {
  StartWorkflowGraphOptions,
  WorkflowGraphDefinitionResolver,
} from './workflow-graph-definition-resolver';
import type { WorkflowGraphStore } from './workflow-graph-store';
import type { WorkflowGraphIR } from './workflow-ir';
import { validateWorkflowGraphIR } from './workflow-ir-validator';
import type { WorkflowObservability } from './workflow-observability';
import type { WorkflowMemoryStore } from './workflow-memory-store';
import type { WorkflowMemoryLimits } from './workflow-memory-policy';
import { serializeWorkflowRuntimeJson } from './workflow-runtime-json';

export class WorkflowGraphStartCoordinator {
  constructor(
    private readonly store: WorkflowGraphStore,
    private readonly definitions: WorkflowGraphDefinitionResolver,
    private readonly versions: WorkflowDefinitionVersionStore,
    private readonly authority: WorkflowExecutionAuthorityGate,
    private readonly memory: WorkflowMemoryStore,
    private readonly advance: (instanceId: string) => Promise<void>,
    private readonly now: () => Date,
    private readonly observability: WorkflowObservability,
  ) {}

  async startRegistered(
    definition: CompiledWorkflowDefinition,
    input: unknown,
    startedBy: string | null,
    authority: WorkflowPersistedExecutionAuthority,
    principal: WorkflowAccessPrincipal,
    options: StartWorkflowGraphOptions = {},
    assertCurrentAuthority?: () => void,
  ): Promise<string> {
    const instanceId = this.createRegistered(definition, input, startedBy, authority, principal, options, assertCurrentAuthority);
    await this.advance(instanceId);
    return instanceId;
  }

  /** Create all durable graph state synchronously; the caller owns post-commit dispatch. */
  createRegistered(
    definition: CompiledWorkflowDefinition,
    input: unknown,
    startedBy: string | null,
    authority: WorkflowPersistedExecutionAuthority,
    principal: WorkflowAccessPrincipal,
    options: StartWorkflowGraphOptions = {},
    assertCurrentAuthority?: () => void,
  ): string {
    const resolved = this.definitions.resolveRegistered(definition, input, options);
    this.assertDefinitionStartAccess(resolved, principal);
    return this.createWithAuthority(
      resolved,
      input,
      startedBy,
      authority,
      this.startSelection(resolved, options, authority),
      options.initialMemory,
      options.memoryLimits,
      assertCurrentAuthority,
    );
  }

  async startPersisted(
    name: string,
    input: unknown,
    startedBy: string | null,
    authority: WorkflowPersistedExecutionAuthority,
    principal: WorkflowAccessPrincipal,
    options: StartWorkflowGraphOptions = {},
    assertCurrentAuthority?: () => void,
  ): Promise<string> {
    const instanceId = this.createPersisted(name, input, startedBy, authority, principal, options, assertCurrentAuthority);
    await this.advance(instanceId);
    return instanceId;
  }

  /** Resolve and atomically create a pinned database-authored graph without running work. */
  createPersisted(
    name: string,
    input: unknown,
    startedBy: string | null,
    authority: WorkflowPersistedExecutionAuthority,
    principal: WorkflowAccessPrincipal,
    options: StartWorkflowGraphOptions = {},
    assertCurrentAuthority?: () => void,
  ): string {
    const resolved = this.definitions.resolvePersisted(
      name,
      input,
      options,
      workflowDefinitionScopeFromTenantId(authority.identity.tenantId),
    );
    this.assertDefinitionStartAccess(resolved, principal);
    return this.createWithAuthority(
      resolved,
      input,
      startedBy,
      authority,
      this.startSelection(resolved, options, authority),
      options.initialMemory,
      options.memoryLimits,
      assertCurrentAuthority,
    );
  }

  /** Test tenant namespace ownership before applying global-code fallback. */
  hasPersistedDefinition(
    name: string,
    authority: WorkflowPersistedExecutionAuthority,
  ): boolean {
    if (authority.identity.tenantId === null) return false;
    return this.versions.findCatalog(
      name,
      workflowDefinitionScopeFromTenantId(authority.identity.tenantId),
    )?.source === 'database';
  }

  /** Final tenant-namespace fence for registered legacy-code starts. */
  assertRegisteredNamespaceCurrent(
    name: string,
    authority: WorkflowPersistedExecutionAuthority,
  ): void {
    const tenantId = authority.identity.tenantId;
    if (tenantId !== null && this.versions.findCatalog(
      name,
      workflowDefinitionScopeFromTenantId(tenantId),
    )) throw workflowNotFound();
  }

  private createWithAuthority(
    definition: ResolvedWorkflowDefinitionVersion,
    input: unknown,
    startedBy: string | null,
    authority: WorkflowPersistedExecutionAuthority,
    selection: WorkflowDefinitionStartSelection,
    initialMemory?: Readonly<Record<string, unknown>>,
    memoryLimits?: Partial<WorkflowMemoryLimits>,
    assertCurrentAuthority?: () => void,
  ): string {
    const graph = definition.graph as WorkflowGraphIR;
    validateWorkflowGraphIR(graph, {
      allowLegacyCompatibility: definition.version.graph_format === 'legacy',
    });
    const instanceId = crypto.randomUUID();
    this.store.createInstance({
      instanceId,
      definitionId: definition.catalog.definition_id,
      definitionVersionId: definition.version.version_id,
      definitionVersion: definition.version.version_number,
      name: definition.catalog.name,
      graph,
      graphJson: definition.version.graph_json,
      graphFingerprint: definition.version.fingerprint,
      inputJson: serializeWorkflowRuntimeJson(input, {
        code: 'WORKFLOW_INPUT_INVALID', label: 'Workflow input',
      }),
      tenantId: authority.identity.tenantId,
      startedBy,
      now: this.now().toISOString(),
    }, () => {
      assertCurrentAuthority?.();
      this.authority.insertCurrent(
        instanceId,
        authority,
        authority.identity.tenantId,
      );
      if (memoryLimits !== undefined) {
        this.memory.createInstancePolicy(instanceId, memoryLimits);
      }
      if (initialMemory !== undefined) {
        this.memory.transaction(
          { instanceId, kind: 'instance' },
          undefined,
          (memory) => {
            for (const [key, value] of Object.entries(initialMemory)) {
              memory.set(key, value, { expectedVersion: null });
            }
          },
        );
      }
      if (!this.versions.isStartSelectionCurrent(selection)) throw workflowNotFound();
    });
    this.observability.emitAfterCommit(OBS_CODES.WORKFLOW_INSTANCE_STARTED, {
      metadata: {
        instanceId,
        name: definition.catalog.name,
        version: definition.version.version_number,
        startedBy,
      },
    });
    return instanceId;
  }

  private startSelection(
    definition: ResolvedWorkflowDefinitionVersion,
    options: StartWorkflowGraphOptions,
    authority: WorkflowPersistedExecutionAuthority,
  ): WorkflowDefinitionStartSelection {
    const scope = Object.freeze({
      type: definition.catalog.scope_type as 'application' | 'tenant',
      id: definition.catalog.scope_id,
    });
    return Object.freeze({
      definitionId: definition.catalog.definition_id,
      versionId: definition.version.version_id,
      name: definition.catalog.name,
      source: definition.version.source,
      scope,
      implicit: options.version === undefined,
      ...(authority.identity.tenantId !== null
        && definition.version.source === 'code'
        && definition.catalog.scope_type === 'application'
        ? { forbidTenantShadowId: authority.identity.tenantId }
        : {}),
    });
  }

  private assertDefinitionStartAccess(
    definition: ResolvedWorkflowDefinitionVersion,
    principal: WorkflowAccessPrincipal,
  ): void {
    const access = definition.accessPolicy === null
      ? undefined
      : freezeWorkflowAccessPolicy(
          definition.accessPolicy as Parameters<typeof freezeWorkflowAccessPolicy>[0],
          definition.catalog.name,
        );
    if (!canAccessWorkflowDefinition({ access }, 'start', principal)) {
      throw new WorkflowError('Workflow not found', 'WORKFLOW_NOT_FOUND', 404);
    }
  }
}
