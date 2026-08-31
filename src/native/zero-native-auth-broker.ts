/** Process-wide broker registry preventing duplicate owners of one native vault namespace. */

import { NativeAuthError } from './errors';
import { createNativeAuthBroker, type NativeAuthBroker } from './native-auth-broker';
import { resolveZeroNativeIssuer } from './server-url';
import { resolveNativeStorageNamespace } from './storage-namespace';
import { createZeroNativeAuth, type ZeroNativeAuthOptions } from './zero-native-auth';

interface BrokerEntry {
  broker: NativeAuthBroker;
  fingerprint: string;
}

const brokers = new Map<string, BrokerEntry>();

/** Return the single credential owner for this process and storage namespace. */
export function createZeroNativeAuthBroker(options: ZeroNativeAuthOptions): NativeAuthBroker {
  const issuer = resolveZeroNativeIssuer(options.serverUrl);
  const clientId = options.clientId.trim();
  const candidate = createZeroNativeAuth(options);
  const namespace = resolveNativeStorageNamespace(
    options.storageNamespace,
    `zero.native.${encodeURIComponent(issuer)}.${encodeURIComponent(clientId)}`,
  );
  const fingerprint = brokerFingerprint(options, issuer, clientId);
  const existing = brokers.get(namespace);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new NativeAuthError(
        'A different native auth configuration already owns this storageNamespace.',
        'NATIVE_BROKER_CONFIG_CONFLICT',
      );
    }
    return existing.broker;
  }
  const broker = createNativeAuthBroker(candidate);
  brokers.set(namespace, { broker, fingerprint });
  return broker;
}

function brokerFingerprint(options: ZeroNativeAuthOptions, issuer: string, clientId: string): string {
  return JSON.stringify({
    issuer,
    clientId,
    redirectUri: options.redirectUri ?? null,
    scopes: [...new Set(['openid', ...(options.scopes ?? ['profile', 'email'])])].sort(),
    authorizationTimeoutMs: options.authorizationTimeoutMs ?? 900_000,
    networkTimeoutMs: options.networkTimeoutMs ?? 15_000,
    clockSkewSeconds: options.clockSkewSeconds ?? 30,
  });
}
