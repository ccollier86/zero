/** One request's live Guardian boundary. No scope, principal or management claim comes from the command body. */
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import { canManageServiceDataScope } from '../auth/service-data-authority';
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import { AuthError, type PermissionKey } from '../auth/types';
import type { WorkflowDeferredStartBridge } from '../workflows/workflow-deferred-start-bridge';
import type { WorkflowPersistedExecutionAuthority } from '../workflows/workflow-execution-authority';
import { jobActorFromAuthority } from './admission';
import type { ResolvedJobsConfig } from './config';
import { JobsError } from './error';
import type { JobActor } from './realm-model';

export interface JobsAuthority {
  readonly access: RequestAuthorizationAccess;
  readonly scope: ServiceDataScope;
  assertCurrentAuthoritySync(): void;
  assertCurrentAuthority(): Promise<void>;
  readonly signal?: AbortSignal;
}
export interface JobRequestAuthority {
  readonly actor: JobActor;
  readonly authority: WorkflowPersistedExecutionAuthority;
  readonly scope: ServiceDataScope;
  readonly signal: AbortSignal;
  guard(): void;
  confirm(): Promise<void>;
}
export async function admitJobRequest(request: JobsAuthority, bridge: WorkflowDeferredStartBridge, config: ResolvedJobsConfig,
  closing: AbortSignal, supplied?: AbortSignal): Promise<JobRequestAuthority> {
  if (supplied !== undefined && !(supplied instanceof AbortSignal) || request.signal !== undefined && !(request.signal instanceof AbortSignal)) throw new JobsError('JOBS_INPUT_INVALID');
  const signal = AbortSignal.any([closing, ...[supplied, request.signal].filter((item): item is AbortSignal => item !== undefined)]);
  await request.assertCurrentAuthority();
  const scopeId = serviceDataScopeKey(request.scope);
  const guard = () => {
    signal.throwIfAborted(); bridge.assertRuntimeCurrent();
    invokeSynchronousAuthCallback(request.assertCurrentAuthoritySync, { component: 'jobs', invariant: 'current-authority-is-synchronous',
      message: 'Job authority checks must not yield.', createError: () => new JobsError('JOBS_CONFIG_INVALID') });
    request.access.authorize({ user: 'required', credentials: ['session'] });
    if (serviceDataScopeKey(request.scope) !== scopeId) throw new JobsError('JOBS_AUTHORITY_RETIRED');
  };
  guard();
  const authority = bridge.actor(request.access.requireUser());
  let manageAll = canManageServiceDataScope(request.access, request.scope, 'jobs:manage' as PermissionKey);
  if (config.manage !== null) {
    try { request.access.authorize(config.manage); manageAll = true; }
    catch (error) { if (!(error instanceof AuthError) || ![401, 403].includes(error.status)) throw error; manageAll = false; }
  }
  const actor = jobActorFromAuthority(authority, request.scope, manageAll);
  const capturedGuard = () => { guard(); bridge.assertCurrent(authority); };
  return Object.freeze({ actor, authority, scope: request.scope, signal, guard: capturedGuard,
    async confirm() { await request.assertCurrentAuthority(); capturedGuard(); } });
}
