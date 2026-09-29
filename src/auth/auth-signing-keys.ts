/** Auth signing-key loading, generation, and durable persistence. */

import { calculateJwkThumbprint, importJWK, type JWK } from 'jose';
import { AUTH_DEFAULTS, type TokenServiceConfig } from './types';

export interface AuthSigningKeys {
  readonly privateKey: CryptoKey;
  readonly publicKey: CryptoKey;
  readonly publicKeyJWK: JWK;
  readonly keyId: string;
}

interface SerializedAuthSigningKeys {
  privateJwk: string;
  keyId: string;
}

/** Resolve the configured key or atomically establish a durable app keypair. */
export async function loadOrCreateAuthSigningKeys(
  config: TokenServiceConfig,
): Promise<AuthSigningKeys> {
  const envKey = process.env[AUTH_DEFAULTS.signingKeyEnvKey];
  if (envKey) return importEnvironmentKey(envKey);

  const getConfig = config.db.prepare(
    'SELECT value FROM _auth_config WHERE key = ?',
  );
  const initial = readSerializedSigningKeys(getConfig);
  if (initial) {
    return importPrivateJwk(JSON.parse(initial.privateJwk) as JWK, initial.keyId);
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const keyId = crypto.randomUUID();
  const privateJWK = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const insertConfig = config.db.prepare(
    'INSERT OR IGNORE INTO _auth_config (key, value) VALUES (?, ?)',
  );
  const selected = config.db.transaction(() => {
    // ReactiveDB uses BEGIN IMMEDIATE. Exactly one replica can establish the
    // pair; every loser re-reads and imports that winner while the same writer
    // lock protects both rows. INSERT OR IGNORE also repairs a legacy partial
    // pair without replacing whichever half was already durable.
    const durable = readSerializedSigningKeys(getConfig);
    if (durable) return durable;

    insertConfig.run('signing_key_private', JSON.stringify(privateJWK));
    insertConfig.run('signing_key_id', keyId);
    const established = readSerializedSigningKeys(getConfig);
    if (!established) {
      throw new Error('[auth] Failed to establish a complete signing-key pair.');
    }
    return established;
  });
  return importPrivateJwk(JSON.parse(selected.privateJwk) as JWK, selected.keyId);
}

function readSerializedSigningKeys(statement: {
  get(key: string): unknown;
}): SerializedAuthSigningKeys | null {
  const privateRow = statement.get('signing_key_private') as { value: string } | null;
  const keyIdRow = statement.get('signing_key_id') as { value: string } | null;
  if (!privateRow || !keyIdRow) return null;
  return { privateJwk: privateRow.value, keyId: keyIdRow.value };
}

async function importEnvironmentKey(value: string): Promise<AuthSigningKeys> {
  let jwk: JWK;
  if (value.startsWith('{')) {
    jwk = JSON.parse(value) as JWK;
  } else if (value.startsWith('-----BEGIN')) {
    throw new Error(
      'PEM signing keys are not supported. Use a JWK JSON object or base64-encoded JWK.',
    );
  } else {
    jwk = JSON.parse(Buffer.from(value, 'base64').toString('utf-8')) as JWK;
  }
  const keyId = jwk.kid ?? await calculateJwkThumbprint(jwk, 'sha256');
  return importPrivateJwk(jwk, keyId);
}

async function importPrivateJwk(jwk: JWK, keyId: string): Promise<AuthSigningKeys> {
  const publicKeyJWK: JWK = {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    kid: keyId,
    alg: 'ES256',
    use: 'sig',
  };
  return {
    privateKey: await importCryptoKey(jwk),
    publicKey: await importCryptoKey(publicKeyJWK),
    publicKeyJWK,
    keyId,
  };
}

async function importCryptoKey(jwk: JWK): Promise<CryptoKey> {
  return await importJWK(jwk, 'ES256') as CryptoKey;
}
