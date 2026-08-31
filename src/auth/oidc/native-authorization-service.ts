/** Small facade over focused native authorization and token operations. */

import type { TokenService } from '../token-service';
import type { UserStore } from '../user-store';
import { parseNativeAuthContinuation } from '../native';
import type { NativeAuthorizationRequestRecord } from './native-auth-records';
import { authorizationErrorTarget } from './native-authorization-error-target';
import type { NativeCodeExchangeInput, NativeRefreshInput } from './native-auth-service-types';
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

export class NativeAuthorizationService {
  private readonly context: NativeServiceContext;
  constructor(
    config: NativeAuthorizationServiceConfig,
    requests: NativeRequestStore,
    codes: NativeCodeStore,
    sessions: NativeSessionStore,
    users: UserStore,
    tokens: TokenService
  ) {
    this.context = { config, requests, codes, sessions, users, tokens };
  }
  start(url: URL, request?: Request, peerAddress?: string | null) {
    return startNativeAuthorization(this.context, url, request, peerAddress);
  }
  getRequest(rawRequestId: string): NativeAuthorizationRequestRecord | null {
    return getNativeRequest(this.context, rawRequestId);
  }
  getClientName(clientId: string): string {
    return authorizationClient(this.context, clientId).name;
  }
  getErrorTarget(url: URL, rawRequestId?: string | null) {
    return authorizationErrorTarget(this.context, url, rawRequestId);
  }
  beginRegistration(rawRequestId: string): boolean {
    return this.context.requests.beginRegistration(rawRequestId);
  }
  consumeTerminal(rawRequestId: string): NativeAuthorizationRequestRecord | null {
    return this.context.requests.consumeTerminal(rawRequestId);
  }
  claimContinuationForUser(value: unknown, userId: string): string | null {
    const parsed = parseNativeAuthContinuation(value);
    if (!parsed || !this.context.requests.claimForUser(parsed.requestId, userId)) return null;
    return parsed.continuation;
  }
  validateContinuationForUser(value: unknown, userId: string): string | null {
    const parsed = parseNativeAuthContinuation(value);
    if (!parsed || !this.context.requests.matchesUser(parsed.requestId, userId)) return null;
    return parsed.continuation;
  }
  validateAvailableContinuation(value: unknown): string | null {
    const parsed = parseNativeAuthContinuation(value);
    if (!parsed || !this.context.requests.isAvailable(parsed.requestId)) return null;
    return parsed.continuation;
  }
  releaseContinuationForUser(value: unknown, userId: string): boolean {
    const parsed = parseNativeAuthContinuation(value);
    return Boolean(parsed && this.context.requests.releaseForUser(parsed.requestId, userId));
  }
  approve(rawRequestId: string, userId: string) {
    return approveNativeRequest(this.context, rawRequestId, userId);
  }

  deny(rawRequestId: string) {
    return denyNativeRequest(this.context, rawRequestId);
  }
  exchangeCode(input: NativeCodeExchangeInput) {
    return exchangeNativeCode(this.context, input);
  }

  refresh(input: NativeRefreshInput) {
    return rotateNativeRefresh(this.context, input);
  }
  revoke(rawToken: string, clientId: string): void {
    revokeNativeSession(this.context, rawToken, clientId);
  }
}

export type { NativeAuthorizationServiceConfig } from './native-service-context';
