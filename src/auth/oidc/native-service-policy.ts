/** Shared native grant policy helpers with mode-specific public errors. */

import { NativeAuthorizationError } from '../native';
import type { UserStore } from '../user-store';
import { canUserReceiveAuthTokens } from '../auth-user-eligibility';
import type { NativeServiceContext } from './native-service-context';
import { NativeTokenError } from './native-token-error';

export function authorizationClient(context: NativeServiceContext, clientId: string) {
  const client = context.config.native.clients.find((item) => item.clientId === clientId);
  if (!client) throw new NativeAuthorizationError('unauthorized_client', 'Unknown client.');
  return client;
}

export function tokenClient(context: NativeServiceContext, clientId: string) {
  if (!context.config.native.enabled) {
    throw new NativeTokenError('invalid_client', 'Native authentication is disabled.');
  }
  const client = context.config.native.clients.find((item) => item.clientId === clientId);
  if (!client) throw new NativeTokenError('invalid_client', 'Unknown native client.');
  return client;
}

export function invalidGrant(): never {
  throw new NativeTokenError('invalid_grant', 'The authorization grant is invalid or expired.');
}

export function canReceiveTokens(user: ReturnType<UserStore['getUserById']>): boolean {
  return canUserReceiveAuthTokens(user);
}
