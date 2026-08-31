/** OAuth token rotation and revocation endpoints for native public clients. */

import { Elysia } from 'elysia';
import { NativeAuthorizationError } from '../native';
import type { NativeAuthorizationService } from './native-authorization-service';
import { rejectNativeClientAuthorization } from './native-client-auth';
import {
  readNativeForm,
  rejectClientSecret,
  requiredFormField,
} from './native-form';
import { oauthEmpty, oauthJson } from './native-http';
import type { NativeAuthHttpConfig } from './native-plugin-types';
import { NativeTokenError, nativeTokenErrorResponse } from './native-token-error';

export function createNativeTokenPlugin(config: NativeAuthHttpConfig) {
  return new Elysia({ name: 'auth-native-token' })
    .post('/oauth/token', ({ request }) => tokenRequest(config, request))
    .post('/oauth/revoke', ({ request }) => revokeRequest(config, request));
}

async function tokenRequest(config: NativeAuthHttpConfig, request: Request): Promise<Response> {
  try {
    rejectNativeClientAuthorization(request);
    const form = await readNativeForm(request);
    rejectClientSecret(form);
    const grantType = requiredFormField(form, 'grant_type');
    const service = requireService(config);
    if (grantType === 'authorization_code') {
      const result = await service.exchangeCode({
        code: requiredFormField(form, 'code'),
        clientId: requiredFormField(form, 'client_id'),
        redirectUri: requiredFormField(form, 'redirect_uri'),
        codeVerifier: requiredFormField(form, 'code_verifier'),
      });
      return oauthJson(result);
    }
    if (grantType === 'refresh_token') {
      const result = await service.refresh({
        refreshToken: requiredFormField(form, 'refresh_token'),
        clientId: requiredFormField(form, 'client_id'),
      });
      return oauthJson(result);
    }
    throw new NativeTokenError('unsupported_grant_type', 'Unsupported grant type.');
  } catch (error) {
    return nativeTokenErrorResponse(asTokenError(error));
  }
}

async function revokeRequest(config: NativeAuthHttpConfig, request: Request): Promise<Response> {
  try {
    rejectNativeClientAuthorization(request);
    const form = await readNativeForm(request);
    rejectClientSecret(form);
    requireService(config).revoke(
      requiredFormField(form, 'token'),
      requiredFormField(form, 'client_id')
    );
  } catch (error) {
    return nativeTokenErrorResponse(asTokenError(error));
  }
  return oauthEmpty();
}

function requireService(config: NativeAuthHttpConfig): NativeAuthorizationService {
  const service = config.getService();
  if (!service) throw new NativeTokenError('invalid_request', 'Native auth is unavailable.', 503);
  return service;
}

function asTokenError(error: unknown): NativeTokenError {
  if (error instanceof NativeTokenError) return error;
  if (error instanceof NativeAuthorizationError && error.code === 'unauthorized_client') {
    return new NativeTokenError('invalid_client', 'Unknown native client.');
  }
  return new NativeTokenError('invalid_request', 'Token request was rejected.');
}
