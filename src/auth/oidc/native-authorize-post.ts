/** Browser confirmation POST half of native authorization. */

import { NativeAuthorizationError } from '../native';
import { nativeAuthorizationFailure } from './native-authorization-failure';
import {
  authorizationProblem,
  requireNativeService,
  resolveNativePagePost,
} from './native-authorize-helpers';
import { requiredFormField, readNativeForm } from './native-form';
import { appendAuthorizationResult, nativeRedirect } from './native-http';
import type { NativeAuthorizationService } from './native-authorization-service';
import type { NativeAuthHttpConfig } from './native-plugin-types';
import { emitUnexpectedNativeRequestFailure } from './native-request-failure';

export async function authorizeNativePost(
  config: NativeAuthHttpConfig,
  request: Request,
): Promise<Response> {
  if (request.headers.get('origin') !== new URL(config.issuer).origin) {
    return authorizationProblem('Authorization confirmation was rejected.');
  }
  let service: NativeAuthorizationService | null = null;
  let rawRequestId: string | null = null;
  try {
    service = requireNativeService(config);
    const form = await readNativeForm(request);
    rawRequestId = requiredFormField(form, 'request_id');
    const decision = requiredFormField(form, 'decision');
    const pending = service.getRequest(rawRequestId);
    if (!pending) fail('invalid_request', 'Authorization request expired or was already used.');
    const auth = await resolveNativePagePost(request, config);
    if (!auth) fail('access_denied', 'Your sign-in session expired.');
    if (pending.boundUserId !== auth.userId) {
      fail('access_denied', 'This authorization belongs to a different account.');
    }
    if (!service.validateContinuationForAuth(
      `/auth/oauth/authorize?request_id=${encodeURIComponent(rawRequestId)}`,
      auth,
    )) {
      fail('access_denied', 'The active organization changed during authorization.');
    }

    if (decision === 'deny') {
      const denied = service.deny(rawRequestId, auth);
      if (!denied) fail('invalid_request', 'Authorization request expired.');
      return nativeRedirect(appendAuthorizationResult(denied.redirectUri, {
        error: 'access_denied', state: denied.state, iss: config.issuer,
      }));
    }
    if (decision !== 'approve') fail('invalid_request', 'Invalid authorization decision.');
    const issued = service.approve(rawRequestId, auth);
    if (!issued) fail('access_denied', 'This account cannot authorize the application.');
    return nativeRedirect(appendAuthorizationResult(issued.request.redirectUri, {
      code: issued.rawCode, state: issued.request.state, iss: config.issuer,
    }));
  } catch (error) {
    emitUnexpectedNativeRequestFailure(config, 'authorize.post', error);
    return nativeAuthorizationFailure(
      config.issuer, error,
      service?.getErrorTarget(new URL(request.url), rawRequestId) ?? null,
    );
  }
}

function fail(code: ConstructorParameters<typeof NativeAuthorizationError>[0], message: string): never {
  throw new NativeAuthorizationError(code, message);
}
