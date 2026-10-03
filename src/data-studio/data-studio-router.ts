/** Zero-native HTTP router for the organization-scoped Data Studio service. */

import {
  defineRouter,
  type ZeroRouterDefinition,
} from '../frontend/server/server-extensions';
import { createDataStudioRowEndpoints } from './data-studio-row-endpoints';
import { DATA_STUDIO_TENANT_AUTH } from './data-studio-router-runtime';
import { createDataStudioTableEndpoints } from './data-studio-table-endpoints';

const BASE_PATH = '/api/_zero/data-studio';

/** Mount this router only when Data Studio's realm/resources are configured. */
export function createDataStudioRouter(): ZeroRouterDefinition {
  return defineRouter({
    name: 'zero-data-studio',
    prefix: BASE_PATH,
    auth: DATA_STUDIO_TENANT_AUTH,
    routes: [
      ...createDataStudioTableEndpoints(),
      ...createDataStudioRowEndpoints(),
    ],
  });
}
