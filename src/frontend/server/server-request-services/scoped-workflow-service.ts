import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import type { ServiceDataScope } from '../../../auth/service-data-scope';
import { canManageWorkflowScope } from '../../../workflows/workflow-access';
import type { WorkflowPublicTopology } from '../../../workflows/workflow-public-topology';
import type { WorkflowInstanceListFilter } from '../../../workflows/workflow-repository';
import type { WorkflowService } from '../../../workflows/workflow-service';
import {
  validateWorkflowStartOptions,
  type WorkflowStartOptions,
} from '../../../workflows/workflow-start-options';
import type {
  WorkflowEventRecord,
  WorkflowInstanceRecord,
  WorkflowStepRecord,
} from '../../../workflows/types';
import {
  forbidden,
  notFound,
  restrictedServiceProxy,
  type CompleteServiceMemberInventory,
} from './restricted-service-proxy';

/** Scope-free list controls accepted by a request/activity workflow facade. */
export type ScopedWorkflowInstanceListFilter = Omit<
  WorkflowInstanceListFilter,
  'scope'
>;

/** Request/activity-safe workflow facade enforced by createScopedWorkflowService(). */
export interface ScopedWorkflowService {
  start(
    name: string,
    input?: unknown,
    startedBy?: string,
    options?: WorkflowStartOptions,
  ): Promise<string>;
  run(
    name: string,
    input?: unknown,
    startedBy?: string,
    options?: WorkflowStartOptions,
  ): Promise<string>;
  advance(instanceId: string): Promise<void>;
  sendEvent(
    instanceId: string,
    eventName: string,
    payload?: unknown,
    sentBy?: string,
  ): Promise<boolean>;
  cancel(instanceId: string): void;
  stop(instanceId: string): void;
  pause(instanceId: string): void;
  resume(instanceId: string): Promise<void>;
  getInstance(instanceId: string): WorkflowInstanceRecord | null;
  get(instanceId: string): WorkflowInstanceRecord | null;
  getSteps(instanceId: string): WorkflowStepRecord[];
  getEvents(instanceId: string): WorkflowEventRecord[];
  getPublicTopology(instanceId: string): WorkflowPublicTopology | null;
  listInstances(filter?: ScopedWorkflowInstanceListFilter): WorkflowInstanceRecord[];
  list(filter?: ScopedWorkflowInstanceListFilter): WorkflowInstanceRecord[];
}

type NonRequestWorkflowMember =
  | 'startAsActor'
  | 'runAsActor'
  | 'startAsSystem'
  | 'startAsSystemOnce'
  | 'runAsSystem'
  | 'sendEventAsSystem'
  | 'deliverEventAsSystem'
  | 'captureActorAuthorityAssertion'
  | 'captureActorAuthorityFence'
  | 'pollRetries'
  | 'pollTimeouts'
  | 'recoverInFlight'
  | 'dispose';

const WORKFLOW_SERVICE_INVENTORY: CompleteServiceMemberInventory<
  WorkflowService,
  keyof ScopedWorkflowService,
  NonRequestWorkflowMember
> = true;
void WORKFLOW_SERVICE_INVENTORY;

// Preserve the established diagnostic wording for lifecycle worker methods.
const DENIED_WORKFLOW_METHODS: ReadonlySet<string> = new Set([
  'dispose',
  'getGraphRuntime',
  'pollRetries',
  'pollTimeouts',
  'recoverInFlight',
]);

export function createScopedWorkflowService(
  service: WorkflowService,
  scope: ServiceDataScope,
  access: RequestAuthorizationAccess,
  assertCurrentAuthority: () => Promise<void>,
  assertCurrentAuthoritySync: () => void,
): ScopedWorkflowService {
  const auth = access.context;
  const manageAll = auth ? canManageWorkflowScope(access, scope) : true;
  const requireActor = (userId: string | undefined): void => {
    if (auth && userId !== undefined && userId !== auth.userId) {
      throw forbidden('Workflow actor mismatch');
    }
  };
  const getOwned = (instanceId: string) => {
    const instance = service.getInstance(instanceId, scope);
    if (!instance || (auth && !manageAll && instance.started_by !== auth.userId)) {
      return null;
    }
    return instance;
  };
  const requireOwned = (instanceId: string) => {
    const instance = getOwned(instanceId);
    if (!instance) throw notFound('Workflow not found');
    return instance;
  };
  const methods: ScopedWorkflowService = {
    async start(name, input, startedBy, options = {}) {
      requireActor(startedBy);
      const actor = access.requireUser();
      const startOptions = validateWorkflowStartOptions(options);
      await assertCurrentAuthority();
      const result = await service.runAsActor(
        name, input, actor, startOptions, assertCurrentAuthoritySync,
      );
      await assertCurrentAuthority();
      return result;
    },
    async run(name, input, startedBy, options = {}) {
      requireActor(startedBy);
      const actor = access.requireUser();
      const startOptions = validateWorkflowStartOptions(options);
      await assertCurrentAuthority();
      const result = await service.runAsActor(
        name, input, actor, startOptions, assertCurrentAuthoritySync,
      );
      await assertCurrentAuthority();
      return result;
    },
    async advance(instanceId) {
      await assertCurrentAuthority();
      requireOwned(instanceId);
      const result = await service.advance(instanceId, scope);
      await assertCurrentAuthority();
      return result;
    },
    async sendEvent(instanceId, eventName, payload, sentBy) {
      requireActor(sentBy);
      await assertCurrentAuthority();
      requireOwned(instanceId);
      const actorFence = service.captureActorAuthorityFence(access.requireUser());
      const eventActor = {
        actorId: actorFence.authority.identity.userId,
        tenantId: actorFence.authority.identity.tenantId,
        roles: actorFence.authority.identity.roles,
        ...(auth?.email ? { claims: { email: auth.email } } : {}),
      };
      const result = await service.sendEvent(
        instanceId,
        eventName,
        payload,
        sentBy ?? auth?.userId,
        scope,
        eventActor,
        {
          assertCurrentAuthority: () => {
            assertCurrentAuthoritySync();
            actorFence.assertCurrentAuthority();
          },
          actorAuthority: actorFence.authority,
        },
      );
      await assertCurrentAuthority();
      return result;
    },
    cancel(id) {
      assertCurrentAuthoritySync();
      requireOwned(id);
      return service.cancel(id, scope, {
        assertCurrentAuthority: assertCurrentAuthoritySync,
      });
    },
    stop(id) {
      assertCurrentAuthoritySync();
      requireOwned(id);
      return service.stop(id, scope, {
        assertCurrentAuthority: assertCurrentAuthoritySync,
      });
    },
    pause(id) {
      assertCurrentAuthoritySync();
      requireOwned(id);
      return service.pause(id, scope, {
        assertCurrentAuthority: assertCurrentAuthoritySync,
      });
    },
    async resume(id) {
      await assertCurrentAuthority();
      requireOwned(id);
      const result = await service.resume(id, scope, {
        assertCurrentAuthority: assertCurrentAuthoritySync,
      });
      await assertCurrentAuthority();
      return result;
    },
    getInstance(id) {
      assertCurrentAuthoritySync();
      return getOwned(id);
    },
    get(id) {
      assertCurrentAuthoritySync();
      return getOwned(id);
    },
    getSteps(id) {
      assertCurrentAuthoritySync();
      requireOwned(id);
      return service.getSteps(id, scope);
    },
    getEvents(id) {
      assertCurrentAuthoritySync();
      requireOwned(id);
      return service.getEvents(id, scope);
    },
    getPublicTopology(id) {
      assertCurrentAuthoritySync();
      requireOwned(id);
      return service.getPublicTopology(id, scope);
    },
    listInstances(filter) {
      assertCurrentAuthoritySync();
      return service.listInstances({
        ...(filter ?? {}),
        ...(manageAll ? {} : { startedBy: auth?.userId }),
        scope,
      });
    },
    list(filter) {
      assertCurrentAuthoritySync();
      return service.list({
        ...(filter ?? {}),
        ...(manageAll ? {} : { startedBy: auth?.userId }),
        scope,
      });
    },
  };
  return restrictedServiceProxy(
    service,
    methods,
    DENIED_WORKFLOW_METHODS,
    'Workflow',
  );
}
