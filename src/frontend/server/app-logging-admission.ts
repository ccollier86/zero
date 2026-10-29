/** Managed strict HTTP/document boundary. Recovery remains content-free and cannot relax Guardian authorization. */
import type { Elysia } from 'elysia';
import { resolveRequestAuthContext } from '../../auth/auth.middleware';
import { resolvePageSessionAuth } from '../../auth/page-session';
import { createRequestAuthorizationAccess } from '../../auth/authorization-access';
import { AuthError } from '../../auth/types';
import { getPublicAuthErrorMessage } from '../../auth/auth-error-response';
import { LoggingError } from '../../logging/logging-error';
import { projectLoggingHttpFailure } from '../../logging/logging-http-error';
import { loggingAuthContext } from '../../logging/logging-auth-context';
import { loggingRecoveryPage } from '../../logging/logging-recovery-page';
import { ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER, ZERO_AUTH_TOKEN_SERVICE, ZERO_AUTH_STORE, ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE, ZERO_LOGGING_RUNTIME } from '../../runtime/service-keys';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { createAuthorityRevalidators } from './server-request-services/request-authority';
import { getServerRouteServices } from './server-services';
import type { LoggingAdmissionAuthority } from '../../logging/logging-admission';
import { isLoggingRecoveryRequest } from '../../logging/logging-admission-paths';
import { guardLoggingResponseStream } from './app-logging-response-stream';
import { LOGGING_API } from '../../logging/logging-api-contracts';
import { isPublicLoggingRequest } from '../../logging/logging-public-request';
import { isLoggingDocumentRequest } from '../../logging/logging-document-request';
import { loggingHttpDiagnostic } from './app-logging-http-diagnostic';

const LOGGING_PROJECTION_READS = new Set([LOGGING_API + '/events', LOGGING_API + '/platform/events', LOGGING_API + '/stream']);

/** Install before any protected route mounts, including built-in services and file-router loaders. */
export function installManagedLoggingAdmission(app: Elysia, runtime: ZeroAppRuntime): void {
  const logging = runtime.get(ZERO_LOGGING_RUNTIME);
  if (!logging?.admission.required) return;
  const requests = new WeakMap<Request, { authority: LoggingAdmissionAuthority; fence: () => void; revalidate: () => Promise<void>; id: string; recordTransport: boolean }>();
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' };
  const failure = (error: unknown): Response => {
    if (error instanceof LoggingError) {
      const projected = projectLoggingHttpFailure(error);
      return Response.json(projected.body, { status: projected.status, headers });
    }
    if (error instanceof AuthError) return Response.json({ code: error.code, error: getPublicAuthErrorMessage(error) }, { status: error.status, headers });
    return Response.json({ code: 'LOGGING_AUDIT_UNAVAILABLE', error: 'Audit admission is unavailable.' }, { status: 503, headers });
  };
  app.onBeforeHandle({ as: 'global' }, async ({ request }) => {
    if (isLoggingRecoveryRequest(request) || isPublicLoggingRequest(request)) return;
    try {
      const tokens = runtime.get(ZERO_AUTH_TOKEN_SERVICE);
      const auth = await resolveRequestAuthContext(request, () => tokens, () => runtime.get(ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER))
        ?? await resolvePageSessionAuth(request, tokens);
      if (!auth) return; // Ordinary route authorization still rejects missing/invalid credentials.
      const access = createRequestAuthorizationAccess({ authContext: auth, kernel: runtime.get(ZERO_AUTHORIZATION_KERNEL),
        propertyStore: runtime.get(ZERO_AUTH_STORE), roleAssignments: runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
        assertCurrentProfile: () => tokens?.assertCurrentProfile() });
      access.authorize({ user: 'required', credentials: ['session', 'api-key'] });
      const fences = createAuthorityRevalidators(request, access, getServerRouteServices(runtime));
      const authority = { auth, properties: runtime.get(ZERO_AUTH_STORE)?.getProperties(auth.userId) ?? {} };
      const context = loggingAuthContext(auth, logging.config.policyVersion);
      if (auth.credentialKind === 'api-key' || auth.sessionKind === 'native') {
        await logging.admission.admitMachine(authority, context, fences.asynchronous, request);
      } else logging.admission.assertCurrent(authority, request);
      const id = crypto.randomUUID();
      // These fixed read RPCs own durable investigation-window admission. They
      // still enforce this same authority/delivery gate and release fences,
      // but must not append another event for each live projection refresh.
      const recordTransport = !LOGGING_PROJECTION_READS.has(new URL(request.url).pathname);
      if (recordTransport) loggingHttpDiagnostic(runtime, 'admitted', id);
      fences.synchronous(); logging.admission.assertCurrent(authority, request);
      requests.set(request, { authority, fence: fences.synchronous, revalidate: fences.asynchronous, id, recordTransport });
    } catch (error) {
      if (error instanceof LoggingError && error.code === 'LOGGING_ADMISSION_REQUIRED' && !request.headers.has('authorization')
        && isLoggingDocumentRequest(request)) return loggingRecoveryPage(logging.config.policyVersion);
      return failure(error);
    }
  });
  app.onAfterHandle({ as: 'global' }, async ({ request, response }) => {
    const current = requests.get(request); if (!current) return;
    try {
      current.fence(); logging.admission.assertCurrent(current.authority, request);
      if (current.recordTransport) loggingHttpDiagnostic(runtime, 'prepared', current.id);
      current.fence(); logging.admission.assertCurrent(current.authority, request);
      if (response instanceof Response) return guardLoggingResponseStream(response, request, logging, current.revalidate,
        () => { current.fence(); logging.admission.assertCurrent(current.authority, request); },
        complete => { if (current.recordTransport) loggingHttpDiagnostic(runtime, complete ? 'completed' : 'incomplete', current.id); });
    } catch (error) {
      if (response instanceof Response) await response.body?.cancel().catch(() => {});
      // A handler may already have committed. Never tell a caller it is safe to
      // repeat a write merely because response-release admission expired.
      if (request.method !== 'GET' && request.method !== 'HEAD') return failure(new LoggingError('LOGGING_OUTCOME_UNKNOWN',
        'Protected response could not be released; reconcile the operation before retrying.', 'unknown'));
      return failure(error);
    } finally { requests.delete(request); }
  });
  app.onError({ as: 'global' }, async ({ request }) => {
    const current = requests.get(request); if (!current) return;
    requests.delete(request);
    // No exception bodies are admitted. A handler exception does not prove that
    // every external effect rolled back; writes are deliberately unresolved.
    if (current.recordTransport) loggingHttpDiagnostic(runtime, 'failed', current.id);
  });
}
