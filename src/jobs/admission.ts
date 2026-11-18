/** Code-owned definition admission into the existing Torrent authority/pin store. No effect or database transaction is run here. */
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import type { WorkflowDeferredStartBridge } from '../workflows/workflow-deferred-start-bridge';
import type { WorkflowPersistedExecutionAuthority } from '../workflows/workflow-execution-authority';
import { workflowActorStartPrincipal } from '../workflows/workflow-actor-start-contract';
import { assertJobServiceEligibility, type JobDefinition } from './definition';
import { jobAdmissionDigest, normalizeJobAdmission, type JobAdmission, type JobSeal } from './model';
import type { JobActor } from './realm-model';
import { JobsError } from './error';
import { jobHash, jobText, type JobValue } from './validation';
import type { ScheduleTiming } from './schedule-time';
import { jobSourcePrincipal } from './source-model';

export function jobBinding(admission: JobAdmission, generation: number): string { return 'jobs:' + jobAdmissionDigest(admission) + ':' + generation; }
export function jobDispatchKey(id: string): string { return 'jobs:' + id; }
export function jobActorFromAuthority(authority: WorkflowPersistedExecutionAuthority, scope: ServiceDataScope, manageAll: boolean): JobActor {
  if (authority.kind !== 'actor' || authority.identity.tenantId !== scope.tenantId || authority.identity.scopeKind !== scope.scopeKind) throw new JobsError('JOBS_FORBIDDEN');
  return Object.freeze({ scopeId: serviceDataScopeKey(scope), userId: authority.identity.userId, principal: workflowActorStartPrincipal(authority), manageAll });
}
export function prepareJobAdmission(bridge: WorkflowDeferredStartBridge, definition: JobDefinition, actorAuthority: WorkflowPersistedExecutionAuthority,
  scope: ServiceDataScope, actor: JobActor, request: { id: string; input: unknown; timing: ScheduleTiming; overlap: JobAdmission['overlap']; runAs: JobAdmission['runAs']; generation: number; ownerId?: string; ownerPrincipal?: string }): { admission: JobAdmission; seal: JobSeal } {
  if (definition.origin === 'source') throw new JobsError('JOBS_FORBIDDEN');
  const input = definition.parseInput(request.input), ownerId = request.ownerId ?? actor.userId;
  let authority = actorAuthority;
  if (request.runAs === 'service') {
    assertJobServiceEligibility(definition, scope, ownerId, input);
    authority = bridge.system({ principal: servicePrincipal(definition), reason: 'Scheduled Zero job', scope });
  } else if (ownerId !== actor.userId) throw new JobsError('JOBS_FORBIDDEN');
  const pin = bridge.pin(authority, definition.workflow.name, input, definition.workflow.version);
  const admission = normalizeJobAdmission({ id: request.id, scopeId: actor.scopeId, actorId: ownerId,
    principal: request.runAs === 'actor' ? actor.principal : request.ownerPrincipal ?? actor.principal,
    definition: definition.name, definitionVersion: definition.version, definitionHash: definition.fingerprint,
    workflow: pin, input, timing: request.timing, overlap: request.overlap, runAs: request.runAs });
  return { admission, seal: bridge.seal(authority, jobBinding(admission, request.generation)) };
}
export function assertJobExecutionIdentity(admission: JobAdmission, authority: WorkflowPersistedExecutionAuthority): void {
  const scope = authority.identity.scopeKind === 'application' ? 'application' : 'tenant:' + authority.identity.tenantId;
  if (admission.scopeId !== scope || (admission.runAs === 'actor' ? authority.kind !== 'actor' || authority.identity.userId !== admission.actorId
    || workflowActorStartPrincipal(authority) !== admission.principal : authority.kind !== 'system')
    || admission.source && (authority.kind !== 'system' || authority.identity.principal !== jobSourcePrincipal(admission.source.id))) throw new JobsError('JOBS_STATE_INVALID');
}
export function assertJobDefinitionCurrent(definition: JobDefinition, admission: JobAdmission, authority: WorkflowPersistedExecutionAuthority, scope: ServiceDataScope): void {
  if (admission.source ? definition.origin === 'request' : definition.origin === 'source') throw new JobsError('JOBS_DEFINITION_UNAVAILABLE');
  if (definition.name !== admission.definition || definition.version !== admission.definitionVersion || definition.fingerprint !== admission.definitionHash
    || definition.workflow.name !== admission.workflow.name || definition.workflow.version !== admission.workflow.version
    || jobHash(definition.parseInput(admission.input)) !== jobHash(admission.input)) throw new JobsError('JOBS_DEFINITION_UNAVAILABLE');
  if (admission.source) {
    if (authority.kind !== 'system' || authority.identity.principal !== jobSourcePrincipal(admission.source.id)) throw new JobsError('JOBS_STATE_INVALID');
    // Fresh source ownership/policy is checked by JobsSourceBroker after the
    // pool wait and again through Torrent's synchronous final start fence.
  } else if (admission.runAs === 'service') {
    if (authority.kind !== 'system' || authority.identity.principal !== servicePrincipal(definition)) throw new JobsError('JOBS_STATE_INVALID');
    assertJobServiceEligibility(definition, scope, admission.actorId, admission.input);
  }
}
function servicePrincipal(definition: JobDefinition): string {
  if (!definition.service) throw new JobsError('JOBS_FORBIDDEN'); return 'jobs:' + jobText(definition.service.principal, 96);
}
