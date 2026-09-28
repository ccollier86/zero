/** Refresh-credential protected tenant operations for native public clients. */

import { Elysia } from 'elysia';
import { NativeAuthorizationError } from '../native';
import type { NativeAuthorizationService } from './native-authorization-service';
import { rejectNativeClientAuthorization } from './native-client-auth';
import { readNativeForm, rejectClientSecret, requiredFormField } from './native-form';
import { oauthJson } from './native-http';
import type { NativeAuthHttpConfig } from './native-plugin-types';
import { NativeTokenError, nativeTokenErrorResponse } from './native-token-error';
import { authAuditRequestFromRequest } from '../auth-audit-service';

export function createNativeTenantPlugin(config: NativeAuthHttpConfig) {
  return new Elysia({ name: 'auth-native-tenants' })
    .post('/oauth/tenants', ({ request }) => listRequest(config, request))
    .post('/oauth/tenants/switch', ({ request }) => switchRequest(config, request));
}

async function listRequest(config: NativeAuthHttpConfig, request: Request): Promise<Response> {
  try {
    const { service, form } = await resolveRequest(config, request);
    return oauthJson(service.listTenants({
      refreshToken: requiredFormField(form, 'refresh_token'),
      clientId: requiredFormField(form, 'client_id'),
    }));
  } catch (error) {
    return nativeTokenErrorResponse(asTokenError(error));
  }
}

async function switchRequest(config: NativeAuthHttpConfig, request: Request): Promise<Response> {
  try {
    const { service, form } = await resolveRequest(config, request);
    return oauthJson(await service.switchTenant({
      refreshToken: requiredFormField(form, 'refresh_token'),
      clientId: requiredFormField(form, 'client_id'),
      tenantId: requiredFormField(form, 'tenant_id'),
      auditRequest: authAuditRequestFromRequest(request),
    }));
  } catch (error) {
    return nativeTokenErrorResponse(asTokenError(error));
  }
}

async function resolveRequest(config: NativeAuthHttpConfig, request: Request) {
  rejectNativeClientAuthorization(request);
  const form = await readNativeForm(request);
  rejectClientSecret(form);
  const service = config.getService();
  if (!service) throw new NativeTokenError('invalid_request', 'Native auth is unavailable.', 503);
  return { service, form };
}

function asTokenError(error: unknown): NativeTokenError {
  if (error instanceof NativeTokenError) return error;
  if (error instanceof NativeAuthorizationError && error.code === 'unauthorized_client') {
    return new NativeTokenError('invalid_client', 'Unknown native client.');
  }
  return new NativeTokenError('invalid_request', 'Tenant request was rejected.');
}
