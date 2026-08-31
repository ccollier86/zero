/** Browser GET half of native authorization. */

import { NativeAuthorizationError } from '../native';
import { resolvePageSessionAuth } from '../page-session';
import { nativeAuthorizationFailure } from './native-authorization-failure';
import { nativeAuthorizationPage } from './native-authorization-page';
import {
  authContinuationPath,
  requireNativeService,
  singleQueryValue,
} from './native-authorize-helpers';
import { appendAuthorizationResult, nativeRedirect } from './native-http';
import type { NativeAuthHttpConfig } from './native-plugin-types';

export async function authorizeNativeGet(
  config: NativeAuthHttpConfig,
  request: Request,
  peerAddress?: string | null,
): Promise<Response> {
  const service = requireNativeService(config);
  const url = new URL(request.url);
  let rawRequestId = singleQueryValue(url.searchParams, 'request_id');
  const loginHint = singleQueryValue(url.searchParams, 'login_hint');
  try {
    if (!rawRequestId) rawRequestId = service.start(url, request, peerAddress).rawRequestId;
    const pending = service.getRequest(rawRequestId);
    if (!pending) fail('invalid_request', 'Authorization request expired or was already used.');

    const resume = `/auth/oauth/authorize?request_id=${encodeURIComponent(rawRequestId)}`;
    if (pending.prompt === 'none') {
      const terminal = service.consumeTerminal(rawRequestId);
      if (!terminal) fail('invalid_request', 'Authorization request expired.');
      return nativeRedirect(appendAuthorizationResult(terminal.redirectUri, {
        error: 'interaction_required',
        error_description: 'Interactive authorization is required.',
        state: terminal.state,
        iss: config.issuer,
      }));
    }
    if (pending.prompt === 'create') {
      if (!service.beginRegistration(rawRequestId)) {
        fail('invalid_request', 'Registration request expired.');
      }
      return nativeRedirect(authContinuationPath(config.registrationPath, resume, loginHint));
    }

    const auth = await resolvePageSessionAuth(request, config.getTokenService());
    if (!auth) return nativeRedirect(authContinuationPath(config.loginPath, resume, loginHint));
    const claimed = pending.prompt === 'create-resume'
      ? service.validateContinuationForUser(resume, auth.userId)
      : service.claimContinuationForUser(resume, auth.userId);
    if (!claimed) {
      fail('access_denied', 'This authorization belongs to a different account.');
    }
    return nativeAuthorizationPage({
      clientName: service.getClientName(pending.clientId),
      rawRequestId,
      scopes: pending.scope.split(' '),
      userEmail: auth.email,
    });
  } catch (error) {
    return nativeAuthorizationFailure(
      config.issuer, error, service.getErrorTarget(url, rawRequestId)
    );
  }
}

function fail(code: ConstructorParameters<typeof NativeAuthorizationError>[0], message: string): never {
  throw new NativeAuthorizationError(code, message);
}
