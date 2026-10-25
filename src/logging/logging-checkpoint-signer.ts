/** Ed25519 checkpoints with an explicit trusted key ring. Does not read files or environment variables. */
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import type { LoggingCheckpointSigner, SignedLoggingCheckpoint } from './logging-custody-contracts';
import { loggingCanonical, loggingId, loggingRecord, loggingTime } from './logging-validation';
import { LoggingError } from './logging-error';
import { loggingDigest } from './logging-hash';

export function checkpointPayload(checkpoint: Omit<SignedLoggingCheckpoint, 'signature'>): string { return loggingCanonical(checkpoint); }
export function checkpointDigest(checkpoint: SignedLoggingCheckpoint): string { return loggingDigest(checkpoint); }

export function createLoggingCheckpointSigner(options: { keyId: string; privateKey: string | KeyObject; publicKeys: Readonly<Record<string, string>> }): LoggingCheckpointSigner {
  try {
    const keyId = loggingId(options.keyId)!;
    const privateKey = typeof options.privateKey === 'string' ? createPrivateKey(options.privateKey) : options.privateKey;
    if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') throw new Error();
    const publicKeys = snapshotCheckpointKeys(options.publicKeys);
    if (!publicKeys[keyId] || createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !== publicKeys[keyId]) throw new Error();
    return Object.freeze({ keyId, publicKeys, async sign(payload: string, signal: AbortSignal) {
      signal.throwIfAborted();
      if (Buffer.byteLength(payload) > 4096) throw new LoggingError('LOGGING_CONFIG_INVALID', 'Checkpoint payload exceeds its limit.');
      const signature = sign(null, Buffer.from(payload), privateKey).toString('base64');
      signal.throwIfAborted(); return signature;
    } });
  } catch { throw new LoggingError('LOGGING_CONFIG_INVALID', 'An Ed25519 checkpoint signer and matching trusted key ring are required.'); }
}

export function snapshotCheckpointKeys(value: unknown): Readonly<Record<string, string>> {
  const input = loggingRecord(value), entries = Object.entries(input);
  if (entries.length < 1 || entries.length > 32) throw new LoggingError('LOGGING_CONFIG_INVALID', 'Checkpoint key ring size is invalid.');
  const keys: Record<string, string> = Object.create(null);
  for (const [id, pem] of entries) {
    loggingId(id);
    if (typeof pem !== 'string' || pem.length > 4096) throw new LoggingError('LOGGING_CONFIG_INVALID', 'Checkpoint public key is invalid.');
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ed25519') throw new LoggingError('LOGGING_CONFIG_INVALID', 'Checkpoint public keys must be Ed25519.');
    keys[id] = String(key.export({ type: 'spki', format: 'pem' }));
  }
  return Object.freeze(keys);
}

export function verifySignedCheckpoint(value: unknown, ledgerId: string, stream: 'audit' | 'operational', publicKeys: Readonly<Record<string, string>>): SignedLoggingCheckpoint {
  try {
    const checkpoint = normalizeSignedLoggingCheckpoint(value), { signature, ...payload } = checkpoint;
    if (checkpoint.stream !== stream || checkpoint.ledgerId !== ledgerId || !Object.hasOwn(publicKeys, checkpoint.keyId)
      || !verify(null, Buffer.from(checkpointPayload(payload)), publicKeys[checkpoint.keyId]!, Buffer.from(signature, 'base64'))) throw new Error();
    return checkpoint;
  } catch { throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Independent logging checkpoint validation failed.'); }
}

/** Shape validation is separate from signature trust, which remains with the signing/custody owner. */
export function normalizeSignedLoggingCheckpoint(value: unknown): SignedLoggingCheckpoint {
  const r = loggingRecord(value, ['version', 'stream', 'ordinal', 'hash', 'ledgerId', 'issuedAt', 'keyId', 'previousDigest', 'signature']);
  if (r.version !== 1 || r.stream !== 'audit' && r.stream !== 'operational' || typeof r.hash !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash)
    || r.previousDigest !== null && (typeof r.previousDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.previousDigest))
    || typeof r.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(r.signature)) throw new Error();
  return Object.freeze({ version: 1, stream: r.stream, ordinal: loggingTime(r.ordinal), hash: r.hash,
    ledgerId: loggingId(r.ledgerId)!, issuedAt: loggingTime(r.issuedAt), keyId: loggingId(r.keyId)!,
    previousDigest: r.previousDigest as string | null, signature: r.signature });
}
