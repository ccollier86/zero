/**
 * workflow-run-query-service.ts
 *
 * Owns scope-filtered, read-only workflow run queries for the public service
 * facade. It projects safe topology through the graph runtime but does not
 * authorize mutations, execute handlers, or change durable state.
 */

import type { ServiceDataScope } from '../auth/service-data-scope';
import type { WorkflowGraphRuntime } from './workflow-graph-runtime';
import type {
  WorkflowInstanceListFilter,
  WorkflowRepository,
} from './workflow-repository';
import type { WorkflowScopeBoundary } from './workflow-scope-boundary';
import {
  toPublicWorkflowLegacyTopology,
  type WorkflowPublicTopology,
} from './workflow-public-topology';
import type {
  WorkflowEventRecord,
  WorkflowInstanceRecord,
  WorkflowStepRecord,
} from './types';

/** Read workflow runs without weakening their application/tenant boundary. */
export class WorkflowRunQueryService {
  constructor(
    private readonly repository: WorkflowRepository,
    private readonly graph: Pick<
      WorkflowGraphRuntime,
      'isGraphInstance' | 'getPublicTopology'
    >,
    private readonly scopes: WorkflowScopeBoundary,
  ) {}

  /** Return a visible run, or null when the identifier is missing or hidden. */
  getInstance(
    instanceId: string,
    scope?: ServiceDataScope,
  ): WorkflowInstanceRecord | null {
    const boundary = this.scopes.requireScope(scope);
    return this.scopes.findInstance(instanceId, boundary);
  }

  /** Return only steps belonging to a visible, correctly scoped run. */
  getSteps(instanceId: string, scope?: ServiceDataScope): WorkflowStepRecord[] {
    const boundary = this.scopes.requireScope(scope);
    if (!this.scopes.findInstance(instanceId, boundary)) return [];
    return this.repository.getSteps(instanceId)
      .filter((step) => this.scopes.matchesTenant(boundary, step.tenant_id));
  }

  /** Return only audit events belonging to a visible, correctly scoped run. */
  getEvents(instanceId: string, scope?: ServiceDataScope): WorkflowEventRecord[] {
    const boundary = this.scopes.requireScope(scope);
    if (!this.scopes.findInstance(instanceId, boundary)) return [];
    return this.repository.getEvents(instanceId)
      .filter((event) => this.scopes.matchesTenant(boundary, event.tenant_id));
  }

  /** Project payload-free topology for a visible legacy or graph run. */
  getPublicTopology(
    instanceId: string,
    scope?: ServiceDataScope,
  ): WorkflowPublicTopology | null {
    const boundary = this.scopes.requireScope(scope);
    const instance = this.scopes.findInstance(instanceId, boundary);
    if (!instance) return null;
    if (this.graph.isGraphInstance(instanceId)) {
      return this.graph.getPublicTopology(instance);
    }
    return toPublicWorkflowLegacyTopology(
      instance,
      this.getSteps(instanceId, boundary),
    );
  }

  /** List runs through the repository's indexed, scope-aware query contract. */
  listInstances(filter: WorkflowInstanceListFilter = {}): WorkflowInstanceRecord[] {
    const scope = this.scopes.requireScope(filter.scope);
    return this.repository.listInstances({ ...filter, scope });
  }
}
