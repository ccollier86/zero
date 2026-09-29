/** Small facade over focused native authorization and token operations. */

import type { TokenService } from '../token-service';
import type { UserStore } from '../user-store';
import { parseNativeAuthContinuation } from '../native';
import type { AuthContext } from '../types';
import type { NativeAuthorizationRequestRecord } from './native-auth-records';
import { authorizationErrorTarget } from './native-authorization-error-target';
import type {
  NativeCodeExchangeInput,
  NativeRefreshInput,
  NativeTenantListInput,
  NativeTenantSwitchInput,
} from './native-auth-service-types';
import {
  approveNativeRequest,
  denyNativeRequest,
  getNativeRequest,
  startNativeAuthorization,
} from './native-authorization-requests';
import { exchangeNativeCode } from './native-code-exchange';
import type { NativeCodeStore } from './native-code-store';
import { rotateNativeRefresh, revokeNativeSession } from './native-refresh-flow';
import type { NativeRequestStore } from './native-request-store';
import type {
  NativeAuthorizationServiceConfig,
  NativeServiceContext,
} from './native-service-context';
import { authorizationClient } from './native-service-policy';
import type { NativeSessionStore } from './native-session-store';
import { NativeTenantAuthorityService } from './native-tenant-authority';
import { listNativeTenants, switchNativeTenant } from './native-tenant-sessions';
import type { AuthAuditService } from '../auth-audit-service';
import type { AuthAuditRequestContext } from '../auth-audit-types';
import { emitPlatformCode } from '../../observability/sink';
import type { AuthPlatformCodeEmitter } from '../auth-observability';
import {
  captureNativePageAuthorityProof,
  isNativePageAuthorityProofCurrent,
} from './native-page-authority-proof';

export class NativeAuthorizationService {
  private readonly context: NativeServiceContext;
  constructor(
    config: NativeAuthorizationServiceConfig,
    requests: NativeRequestStore,
    codes: NativeCodeStore,
    sessions: NativeSessionStore,
    users: UserStore,
    tokens: TokenService,
    authority: NativeTenantAuthorityService = new NativeTenantAuthorityService('single', null),
    audit?: AuthAuditService,
    requiresMfaAssurance: (userId: string) => boolean = () => false,
    emitCode: AuthPlatformCodeEmitter = emitPlatformCode,
  ) {
    this.context = {
      config,
      requests,
      codes,
      sessions,
      users,
      tokens,
      authority,
      audit,
      requiresMfaAssurance,
      emitCode,
    };
    const assertCurrentProfile = () => tokens.assertCurrentProfile();
    requests.setRuntimeProfileGuard(assertCurrentProfile);
    codes.setRuntimeProfileGuard(assertCurrentProfile);
    sessions.setRuntimeProfileGuard(assertCurrentProfile);
  }
  start(url: URL, request?: Request, peerAddress?: string | null) {
    this.assertCurrentProfile();
    return startNativeAuthorization(this.context, url, request, peerAddress);
  }
  getRequest(rawRequestId: string): NativeAuthorizationRequestRecord | null {
    this.assertCurrentProfile();
    return getNativeRequest(this.context, rawRequestId);
  }
  getClientName(clientId: string): string {
    this.assertCurrentProfile();
    return authorizationClient(this.context, clientId).name;
  }
  getErrorTarget(url: URL, rawRequestId?: string | null) {
    this.assertCurrentProfile();
    return authorizationErrorTarget(this.context, url, rawRequestId);
  }
  beginRegistration(rawRequestId: string): boolean {
    this.assertCurrentProfile();
    return this.context.requests.beginRegistration(rawRequestId);
  }
  consumeTerminal(rawRequestId: string): NativeAuthorizationRequestRecord | null {
    this.assertCurrentProfile();
    return this.context.requests.consumeTerminal(rawRequestId);
  }
  claimContinuationForUser(value: unknown, userId: string): string | null {
    this.assertCurrentProfile();
    const parsed = parseNativeAuthContinuation(value);
    if (!parsed || !this.context.requests.claimForUser(parsed.requestId, userId)) return null;
    return parsed.continuation;
  }
  validateContinuationForUser(value: unknown, userId: string): string | null {
    this.assertCurrentProfile();
    const parsed = parseNativeAuthContinuation(value);
    if (!parsed || !this.context.requests.matchesUser(parsed.requestId, userId)) return null;
    return parsed.continuation;
  }
  claimContinuationForAuth(value: unknown, auth: AuthContext): string | null {
    this.assertCurrentProfile();
    const parsed = parseNativeAuthContinuation(value);
    const proof = captureNativePageAuthorityProof(this.context, auth);
    if (!parsed || !proof || !this.context.requests.claimForAuthority(
      parsed.requestId,
      auth.userId,
      proof.authority,
      () => isNativePageAuthorityProofCurrent(this.context, proof),
    )) return null;
    return parsed.continuation;
  }
  validateContinuationForAuth(value: unknown, auth: AuthContext): string | null {
    this.assertCurrentProfile();
    const parsed = parseNativeAuthContinuation(value);
    const proof = captureNativePageAuthorityProof(this.context, auth);
    if (!parsed || !proof || !isNativePageAuthorityProofCurrent(this.context, proof)
      || !this.context.requests.matchesAuthority(
      parsed.requestId, auth.userId, proof.authority,
    )) return null;
    return parsed.continuation;
  }
  validateAvailableContinuation(value: unknown): string | null {
    this.assertCurrentProfile();
    const parsed = parseNativeAuthContinuation(value);
    if (!parsed || !this.context.requests.isAvailable(parsed.requestId)) return null;
    return parsed.continuation;
  }
  releaseContinuationForUser(value: unknown, userId: string): boolean {
    this.assertCurrentProfile();
    const parsed = parseNativeAuthContinuation(value);
    return Boolean(parsed && this.context.requests.releaseForUser(parsed.requestId, userId));
  }
  approve(rawRequestId: string, auth: AuthContext) {
    this.assertCurrentProfile();
    return approveNativeRequest(this.context, rawRequestId, auth);
  }

  deny(rawRequestId: string, auth: AuthContext) {
    this.assertCurrentProfile();
    return denyNativeRequest(this.context, rawRequestId, auth);
  }
  exchangeCode(input: NativeCodeExchangeInput) {
    this.assertCurrentProfile();
    return exchangeNativeCode(this.context, input);
  }

  refresh(input: NativeRefreshInput) {
    this.assertCurrentProfile();
    return rotateNativeRefresh(this.context, input);
  }
  listTenants(input: NativeTenantListInput) {
    this.assertCurrentProfile();
    return listNativeTenants(this.context, input);
  }
  switchTenant(input: NativeTenantSwitchInput) {
    this.assertCurrentProfile();
    return switchNativeTenant(this.context, input);
  }
  revoke(
    rawToken: string,
    clientId: string,
    auditRequest?: AuthAuditRequestContext,
  ): void {
    this.assertCurrentProfile();
    revokeNativeSession(this.context, rawToken, clientId, auditRequest);
  }

  private assertCurrentProfile(): void {
    this.context.tokens.assertCurrentProfile();
  }
}

export type { NativeAuthorizationServiceConfig } from './native-service-context';
