import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import type { ServiceDataScope } from '../../../auth/service-data-scope';
import { canManageWorkflowScope } from '../../../workflows/workflow-access';
import type { WorkflowService } from '../../../workflows/workflow-service';
import {
  forbidden,
  notFound,
  restrictedServiceProxy,
  type CompleteServiceMemberInventory,
} from './restricted-service-proxy';

type ScopedWorkflowMethods = Pick<
  WorkflowService,
  | 'start'
  | 'run'
  | 'advance'
  | 'sendEvent'
  | 'cancel'
  | 'stop'
  | 'pause'
  | 'resume'
  | 'getInstance'
  | 'get'
  | 'getSteps'
  | 'getEvents'
  | 'listInstances'
  | 'list'
>;

type NonRequestWorkflowMember =
  | 'startAsActor'
  | 'runAsActor'
  | 'startAsSystem'
  | 'runAsSystem'
  | 'pollRetries'
  | 'pollTimeouts'
  | 'recoverInFlight';

const WORKFLOW_SERVICE_INVENTORY: CompleteServiceMemberInventory<
  WorkflowService,
  keyof ScopedWorkflowMethods,
  NonRequestWorkflowMember
> = true;
void WORKFLOW_SERVICE_INVENTORY;

// Preserve the established diagnostic wording for lifecycle worker methods.
const DENIED_WORKFLOW_METHODS: ReadonlySet<string> = new Set([
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
): WorkflowService {
  const auth = access.context;
  const manageAll = auth ? canManageWorkflowScope(access, scope) : true;
  const requireActor = (userId: string | undefined): void => {
    if (auth && userId !== undefined && userId !== auth.userId) {
      throw forbidden('Workflow actor mismatch');
    }
  };
  const requireOwned = (instanceId: string) => {
    const instance = service.getInstance(instanceId, scope);
    if (!instance
      || (auth && !manageAll && instance.started_by !== auth.userId)) {
      throw notFound('Workflow not found');
    }
    return instance;
  };
  const methods: ScopedWorkflowMethods = {
    async start(name, input, startedBy) {
      requireActor(startedBy);
      const actor = access.requireUser();
      await assertCurrentAuthority();
      const result = await service.runAsActor(name, input, actor);
      await assertCurrentAuthority();
      return result;
    },
    async run(name, input, startedBy) {
      requireActor(startedBy);
      const actor = access.requireUser();
      await assertCurrentAuthority();
      const result = await service.runAsActor(name, input, actor);
      await assertCurrentAuthority();
      return result;
    },
    async advance(instanceId) {
      requireOwned(instanceId);
      await assertCurrentAuthority();
      const result = await service.advance(instanceId, scope);
      await assertCurrentAuthority();
      return result;
    },
    async sendEvent(instanceId, eventName, payload, sentBy) {
      requireActor(sentBy);
      requireOwned(instanceId);
      await assertCurrentAuthority();
      const result = await service.sendEvent(
        instanceId,
        eventName,
        payload,
        sentBy ?? auth?.userId,
        scope,
      );
      await assertCurrentAuthority();
      return result;
    },
    cancel(id) {
      requireOwned(id);
      assertCurrentAuthoritySync();
      return service.cancel(id, scope);
    },
    stop(id) {
      requireOwned(id);
      assertCurrentAuthoritySync();
      return service.stop(id, scope);
    },
    pause(id) {
      requireOwned(id);
      assertCurrentAuthoritySync();
      return service.pause(id, scope);
    },
    async resume(id) {
      requireOwned(id);
      await assertCurrentAuthority();
      const result = await service.resume(id, scope);
      await assertCurrentAuthority();
      return result;
    },
    getInstance(id) {
      try {
        return requireOwned(id);
      } catch {
        return null;
      }
    },
    get(id) {
      try {
        return requireOwned(id);
      } catch {
        return null;
      }
    },
    getSteps(id) {
      requireOwned(id);
      return service.getSteps(id, scope);
    },
    getEvents(id) {
      requireOwned(id);
      return service.getEvents(id, scope);
    },
    listInstances(filter) {
      return service.listInstances({
        ...(filter ?? {}),
        ...(manageAll ? {} : { startedBy: auth?.userId }),
        scope,
      });
    },
    list(filter) {
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
