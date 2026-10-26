/** Strict Sync admission uses the same session/scope grant as HTTP; machine leases have a socket owner. */
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_AUTH_TOKEN_SERVICE, ZERO_AUTH_STORE, ZERO_LOGGING_RUNTIME } from '../../runtime/service-keys';
import type { SyncAuthConfig, SyncAuthContext } from '../../sync/types';
import { sameSyncAuthContext } from '../../sync/sync-auth';
import { LoggingError } from '../../logging/logging-error';
import { loggingAuthContext } from '../../logging/logging-auth-context';

export function managedLoggingSyncAdmission(runtime: ZeroAppRuntime): Pick<SyncAuthConfig, 'admitDataAccess' | 'assertDataAdmission'> {
  const logging = runtime.get(ZERO_LOGGING_RUNTIME);
  if (!logging?.admission.required) return {};
  const authority = (auth: SyncAuthContext | null) => {
    if (!auth) throw new LoggingError('LOGGING_ADMISSION_REQUIRED', 'Authenticated audit delivery admission is required.');
    return { auth, properties: runtime.get(ZERO_AUTH_STORE)?.getProperties(auth.userId) ?? {} };
  };
  return {
    async admitDataAccess(auth, owner) {
      const current = authority(auth);
      if (current.auth.sessionKind !== 'native') { logging.admission.assertCurrent(current, owner); return; }
      try { logging.admission.assertCurrent(current, owner); return; }
      catch (error) { if (!(error instanceof LoggingError) || error.code !== 'LOGGING_ADMISSION_REQUIRED') throw error; }
      const tokens = runtime.get(ZERO_AUTH_TOKEN_SERVICE), reference = tokens?.captureAuthContextAuthority(current.auth);
      if (!tokens || !reference) throw new LoggingError('LOGGING_ADMISSION_REQUIRED', 'Durable native audit authority is unavailable.');
      const revalidate = async () => {
        tokens.assertCurrentProfile();
        const live = tokens.resolveAuthContextAuthority(reference);
        if (!live || !sameSyncAuthContext(live, current.auth)) throw new LoggingError('LOGGING_FORBIDDEN', 'Native audit authority changed.');
      };
      await logging.admission.admitMachine(current, loggingAuthContext(current.auth, logging.config.policyVersion), revalidate, owner);
    },
    assertDataAdmission(auth, owner) { logging.admission.assertCurrent(authority(auth), owner); },
  };
}
