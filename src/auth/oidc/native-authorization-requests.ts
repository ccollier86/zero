/** Pending request validation, approval, denial, and safe audit events. */
import {
  classifyNativeRedirectUri,
  findRegisteredNativeRedirectUri,
  NativeAuthorizationError,
  parseNativeAuthorizationRequest,
} from '../native';
import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import type { NativeAuthorizationRequestRecord } from './native-auth-records';
import type { AuthContext } from '../types';
import type { NativeServiceContext } from './native-service-context';
import { authorizationClient, canReceiveTokens } from './native-service-policy';
import { resolveNativeRequestSource } from './native-request-source';

export function startNativeAuthorization(
  context: NativeServiceContext,
  url: URL,
  request?: Request,
  peerAddress?: string | null,
) {
  const parsed = parseNativeAuthorizationRequest(url);
  const client = authorizationClient(context, parsed.clientId);
  if (!findRegisteredNativeRedirectUri(parsed.redirectUri, client.redirectUris)) {
    throw new NativeAuthorizationError('invalid_request', 'redirect_uri is not registered.');
  }
  if (parsed.scopes.some((scope) => !client.scopes.includes(scope))) {
    throw new NativeAuthorizationError('invalid_scope', 'Requested scope is not allowed.');
  }
  const created = context.requests.create({
    clientId: parsed.clientId, redirectUri: parsed.redirectUri,
    scope: parsed.scopes.join(' '), state: parsed.state, nonce: parsed.nonce,
    codeChallenge: parsed.codeChallenge, prompt: nativePrompt(url.searchParams),
    sourceKey: resolveNativeRequestSource(
      context.config.native.requestAdmission, request, parsed.clientId, peerAddress,
    ),
    ttlMs: context.config.requestTtlMs,
  });
  emitPlatformCode(OBS_CODES.AUTH_NATIVE_AUTHORIZATION_REQUESTED, {
    metadata: {
      clientId: parsed.clientId,
      redirectKind: classifyNativeRedirectUri(parsed.redirectUri),
    },
  });
  return { rawRequestId: created.rawRequestId, request: requireRequest(context, created.rawRequestId) };
}

export function getNativeRequest(
  context: NativeServiceContext, rawRequestId: string,
): NativeAuthorizationRequestRecord | null {
  const request = context.requests.get(rawRequestId);
  return request && request.consumedAt === null && request.expiresAt > Date.now()
    ? request : null;
}

export function approveNativeRequest(
  context: NativeServiceContext, rawRequestId: string, auth: AuthContext,
) {
  const userId = auth.userId;
  const user = context.users.getUserById(userId);
  if (!user || !canReceiveTokens(user)) return null;
  const authority = context.authority.capturePageAuthority(auth);
  if (!authority) return null;
  const issued = context.codes.issue(
    rawRequestId, userId, context.users.getAuthGeneration(userId),
    authority, context.config.codeTtlMs,
  );
  if (issued) emitPlatformCode(OBS_CODES.AUTH_NATIVE_AUTHORIZATION_APPROVED, {
    userId, metadata: { clientId: issued.request.clientId },
  });
  return issued;
}

export function denyNativeRequest(context: NativeServiceContext, rawRequestId: string) {
  const denied = context.requests.consumeTerminal(rawRequestId);
  if (denied) emitPlatformCode(OBS_CODES.AUTH_NATIVE_AUTHORIZATION_DENIED, {
    metadata: { clientId: denied.clientId },
  });
  return denied;
}

function requireRequest(context: NativeServiceContext, rawRequestId: string) {
  const request = context.requests.get(rawRequestId);
  if (!request) throw new Error('Native authorization request was not persisted.');
  return request;
}

function nativePrompt(params: URLSearchParams): string | null {
  const prompt = singleOptional(params, 'prompt');
  const screenHint = singleOptional(params, 'screen_hint');
  if (prompt === 'create' || (!prompt && screenHint === 'signup')) return 'create';
  if (prompt === 'none') return 'none';
  if (prompt || (screenHint && screenHint !== 'signup')) {
    throw new NativeAuthorizationError('invalid_request', 'Unsupported authorization prompt.');
  }
  return null;
}

function singleOptional(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  if (values.length > 1) {
    throw new NativeAuthorizationError('invalid_request', `${name} must appear once.`);
  }
  return values[0] || null;
}
