/** Inputs and wire results owned by the native authorization service. */

import type { NativeAuthorizationRequestRecord } from './native-auth-records';
import type { NativeActiveTenant } from './native-tenant-authority';
import type { AuthAuditRequestContext } from '../auth-audit-types';

export interface NativeAuthorizationStart {
  rawRequestId: string;
  request: NativeAuthorizationRequestRecord;
  clientName: string;
}

export interface NativeTokenResult {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  id_token?: string;
  scope: string;
  active_tenant?: NativeActiveTenant;
}

export interface NativeCodeExchangeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface NativeRefreshInput {
  refreshToken: string;
  clientId: string;
  auditRequest?: AuthAuditRequestContext;
}

export interface NativeTenantListInput extends NativeRefreshInput {}

export interface NativeTenantSwitchInput extends NativeRefreshInput {
  tenantId: string;
}

export interface NativeTenantListResult {
  activeTenantId: string | null;
  tenants: NativeActiveTenant[];
}
