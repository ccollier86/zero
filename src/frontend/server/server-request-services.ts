/**
 * Stable public entry point for request-bound server service facades.
 *
 * The implementation is split by policy and service domain under
 * `server-request-services/`; keeping this module as a thin facade preserves
 * the established imports used by route and workflow integrations.
 */

export type {
  AuthorityScopedAuthServices,
  AuthorityScopedObservabilityServices,
  AuthorityScopedServerServices,
  CreateAuthorityScopedServerServicesOptions,
  CreateServerRequestServicesOptions,
  ServerRequestServices,
} from './server-request-services/contracts';
export type {
  ScopedWorkflowInstanceListFilter,
  ScopedWorkflowService,
} from './server-request-services/scoped-workflow-service';
export type { ScopedNotificationService } from './server-request-services/scoped-notification-service';
export type {
  ScopedPdfService,
  ScopedPdfStorageTarget,
} from './server-request-services/request-pdf-service';
export type { ScopedRoomService } from './server-request-services/scoped-room-service';
export type {
  ScopedStorageDriveApi,
  ScopedStorageMethods,
  ScopedStorageObjectApi,
  ScopedStoragePermissionApi,
  ScopedStorageService,
  ScopedStorageUploadData,
  ScopedStorageUploadGrantApi,
} from './server-request-services/scoped-storage-service';

export {
  createAuthorityScopedServerServices,
  createDeferredServerRequestServices,
  createServerRequestServices,
  isServerRequestServices,
} from './server-request-services/create-request-services';

export {
  UnsafeServerServiceAccessError,
} from './server-request-services/request-policy';
