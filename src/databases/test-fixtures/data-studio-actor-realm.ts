/** Exact composed tenant realm shared by the Data Studio app and actor fixture. */

import { DATA_STUDIO_REALM_CONTRIBUTION } from '../../data-studio/data-studio-realm-contribution';
import { composeDatabaseRealm } from '../database-realm-composition';

export const dataStudioActorFixtureRealm = composeDatabaseRealm({
  name: 'data-studio-actor-fixture',
  version: '1',
  contributions: [DATA_STUDIO_REALM_CONTRIBUTION],
});
