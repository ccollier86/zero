/**
 * Stable public entry point for request-bound server service facades.
 *
 * The implementation is split by policy and service domain under
 * `server-request-services/`; keeping this module as a thin facade preserves
 * the established imports used by route and workflow integrations.
 */

export type {
  AuthorityScopedServerServices,
  CreateAuthorityScopedServerServicesOptions,
  CreateServerRequestServicesOptions,
  ServerRequestServices,
} from './server-request-services/contracts';

export {
  createAuthorityScopedServerServices,
  createServerRequestServices,
  isServerRequestServices,
} from './server-request-services/create-request-services';

export {
  UnsafeServerServiceAccessError,
} from './server-request-services/request-policy';
