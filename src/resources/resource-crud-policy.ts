/**
 * resource-crud-policy.ts
 *
 * Evaluates row policy and reauthorizes canonical mutation receipt effects for
 * generated Resource CRUD. Authority capture/fencing and persistence remain in
 * their dedicated collaborators.
 */

import type { Row } from '../sync';
import type {
  ResourceCrudFailure,
  ResourceCrudRequestContext,
} from './resource-crud-contracts';
import type { ResourceCrudFailureMapper } from './resource-crud-failures';
import { resourceAuthorityChangedFailure, resourcePolicyFailure } from './resource-crud-results';
import type { ResourceMutationCommitEffect } from './resource-mutation-receipt';
import type {
  ResourcePolicyAuthorityService,
  ResourcePolicyAuthoritySnapshot,
} from './resource-policy-authority';
import { evaluateResourcePolicy } from './resource-policy-evaluator';
import type { ResourceAction, ResourcePolicyAuthConfig } from './resource-policy-types';
import type { RegisteredResourceDefinition } from './resource-registry';

type MutationAction = Extract<ResourceAction, 'create' | 'update' | 'delete'>;

/** Policy operations shared by default and physical-tenant CRUD engines. */
export class ResourceCrudPolicyService {
  constructor(
    private readonly authConfig: ResourcePolicyAuthConfig,
    private readonly authority: ResourcePolicyAuthorityService,
    private readonly failures: ResourceCrudFailureMapper,
  ) {}

  /** Evaluate a row action against one captured authority snapshot. */
  evaluateRow(
    resource: RegisteredResourceDefinition,
    action: ResourceAction,
    row: Row,
    authority: ResourcePolicyAuthoritySnapshot,
    input?: Record<string, unknown>,
  ) {
    return evaluateResourcePolicy(resource.policy[action]!, {
      action,
      user: authority.user,
      authorization: authority.authorization,
      resource,
      row,
      input,
      authConfig: this.authConfig,
    });
  }

  /**
   * Reauthorize an exact durable receipt effect before returning a replay.
   *
   * Update/delete policy uses the immutable original preimage; create policy
   * receives the original logical input. A later row is never substituted.
   */
  async reauthorizeMutationReceipt(
    resource: RegisteredResourceDefinition,
    action: MutationAction,
    effect: ResourceMutationCommitEffect,
    input: Record<string, unknown> | undefined,
    authority: ResourcePolicyAuthoritySnapshot,
    context: ResourceCrudRequestContext,
  ): Promise<{ row: Row | null } | { failure: ResourceCrudFailure }> {
    const policyRow = action === 'create' ? effect.row : effect.previousRow;
    if (!policyRow) {
      return { failure: this.failures.committedReadback(resource, action) };
    }
    const decision = action === 'create'
      ? await evaluateResourcePolicy(resource.policy.create!, {
          action,
          user: authority.user,
          authorization: authority.authorization,
          resource,
          input,
          authConfig: this.authConfig,
        })
      : await this.evaluateRow(resource, action, policyRow, authority, input);
    if (!decision.allowed) {
      return {
        failure: resourcePolicyFailure(
          decision.status,
          decision.message,
          decision.reason,
        ),
      };
    }
    if (!await this.authority.isCurrent(context, authority)) {
      return { failure: resourceAuthorityChangedFailure() };
    }
    return { row: effect.row };
  }
}
