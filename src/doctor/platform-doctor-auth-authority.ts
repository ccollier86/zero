/** Read-only Guardian authority-revision schema diagnostics. */

import type { Database } from 'bun:sqlite';

import { inspectAuthAuthorityRevisionSchema } from '../auth/auth-authority-revision';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

const AUTH_AUTHORITY_DOCS = './docs/auth/auth-data-plane-capability-matrix.md';

/** Report missing or incompatible managed revision-clock trigger contracts. */
export function checkAuthAuthorityRevisionState(
  system: Database,
  findings: PlatformDoctorFindingSink,
): void {
  const status = inspectAuthAuthorityRevisionSchema(system);
  if (status === 'ready') return;
  addFinding(findings, {
    severity: status === 'invalid' ? 'error' : 'warning',
    code: status === 'invalid'
      ? 'auth.authority_revision.schema_invalid'
      : 'auth.authority_revision.schema_missing',
    path: 'systemDb',
    message: status === 'invalid'
      ? 'The Guardian authority-revision clock or a current managed trigger has an incompatible contract.'
      : 'The system database is missing the Guardian authority-revision clock or a current managed trigger.',
    hint: status === 'invalid'
      ? 'Keep the deployment stopped and restore or explicitly migrate the managed Guardian authority-revision schema.'
      : 'Run the upgraded Guardian initializer before serving authenticated requests.',
    docs: AUTH_AUTHORITY_DOCS,
  });
}
