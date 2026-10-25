/** Synthetic independent custody, actual Ed25519 signatures, rotation, restore and timeout fences. */
import { generateKeyPairSync } from 'node:crypto';
import { expect, test } from 'bun:test';
import { LoggingCheckpointCustody, resolveLoggingCustody } from './logging-custody';
import { checkpointDigest, createLoggingCheckpointSigner, verifySignedCheckpoint } from './logging-checkpoint-signer';
import type { LoggingCustodyConfig, SignedLoggingCheckpoint } from './logging-custody-contracts';
import type { LoggingCheckpoint } from './logging-evidence-contracts';
import { loggingDigest } from './logging-hash';

function key() {
  const pair = generateKeyPairSync('ed25519');
  return { privateKey: pair.privateKey, publicKey: String(pair.publicKey.export({ type: 'spki', format: 'pem' })) };
}
function fixture() {
  const a = key(), retained: SignedLoggingCheckpoint[] = [];
  let latest: SignedLoggingCheckpoint | null = null, fail = false, head: LoggingCheckpoint = { version: 1, stream: 'audit', ordinal: 0, hash: loggingDigest(['genesis']) };
  const config = resolveLoggingCustody({ ledgerId: 'fixture-ledger', signer: createLoggingCheckpointSigner({ keyId: 'key-a', privateKey: a.privateKey, publicKeys: { 'key-a': a.publicKey } }),
    store: { identity: 'separate-custodian', async read() { if (fail) throw new Error('Unavailable'); return latest; },
      async append(checkpoint: SignedLoggingCheckpoint, expected: string | null) {
        if (fail) throw new Error('Unavailable');
        if (expected !== (latest ? checkpointDigest(latest) : null)) throw new Error('Conflict');
        retained.push(checkpoint); latest = checkpoint; return checkpoint;
      } } });
  const verify = async (_after: number, cp?: LoggingCheckpoint) => {
    if (_after > head.ordinal || cp && (cp.ordinal > head.ordinal || cp.ordinal === head.ordinal && cp.hash !== head.hash)) throw new Error('Restore mismatch');
    return { checked: 0, expired: 0, throughOrdinal: head.ordinal, hasMore: false, checkpoint: head };
  };
  return { a, config, retained, verify, head(value: number) { head = { ...head, ordinal: value, hash: loggingDigest(['head', value]) }; }, unavailable(value: boolean) { fail = value; } };
}

test('independent checkpoints are signed, immutable, monotonic and restored tails cannot silently roll back', async () => {
  const f = fixture(); let invalidated = 0;
  const custody = new LoggingCheckpointCustody(f.config, () => { invalidated++; });
  await custody.initialize('audit', f.verify); expect(f.retained).toHaveLength(1);
  f.head(10); await custody.seal('audit', f.verify); expect(f.retained).toHaveLength(2);
  expect(f.retained[1]!.previousDigest).toBe(checkpointDigest(f.retained[0]!));
  expect(verifySignedCheckpoint(f.retained[1], f.config.ledgerId, 'audit', f.config.signer.publicKeys)).toEqual(f.retained[1]!);
  expect(() => verifySignedCheckpoint({ ...f.retained[1], ordinal: 11 }, f.config.ledgerId, 'audit', f.config.signer.publicKeys)).toThrow();
  f.head(5); await expect(custody.seal('audit', f.verify)).rejects.toThrow('Restore mismatch'); expect(invalidated).toBe(1);
  expect(f.retained).toHaveLength(2); await custody.close();
});

test('key rotation retains old verification keys and seals the same head under the new signing identity', async () => {
  const f = fixture(), first = new LoggingCheckpointCustody(f.config, () => {});
  await first.initialize('audit', f.verify); await first.close();
  const b = key();
  const signer = createLoggingCheckpointSigner({ keyId: 'key-b', privateKey: b.privateKey, publicKeys: { ...f.config.signer.publicKeys, 'key-b': b.publicKey } });
  const rotated = new LoggingCheckpointCustody({ ...f.config, signer }, () => {});
  await rotated.initialize('audit', f.verify);
  expect(f.retained.map(cp => cp.keyId)).toEqual(['key-a', 'key-b']);
  expect(f.retained[1]!.previousDigest).toBe(checkpointDigest(f.retained[0]!));
  await rotated.close();
  const untrusted = new LoggingCheckpointCustody({ ...f.config, signer }, () => {});
  await untrusted.initialize('audit', f.verify); await untrusted.close();
});

test('custodian failure rejects acknowledgment, invalidates grants and preserves prior independent evidence', async () => {
  const f = fixture(); let invalidated = 0;
  const custody = new LoggingCheckpointCustody(f.config, () => { invalidated++; });
  await custody.initialize('audit', f.verify); f.unavailable(true); f.head(1);
  await expect(custody.seal('audit', f.verify)).rejects.toThrow(); expect(invalidated).toBe(1);
  expect(f.retained).toHaveLength(1); expect(custody.diagnostics().state).toBe('unavailable');
  f.unavailable(false); await custody.seal('audit', f.verify); expect(custody.diagnostics().state).toBe('ready');
  await custody.close(); await expect(custody.seal('audit', f.verify)).rejects.toThrow();
});

test('existing unsigned evidence requires explicit verified adoption and a bounded initial scan', async () => {
  const f = fixture(); f.head(20);
  await expect(new LoggingCheckpointCustody(f.config, () => {}).initialize('audit', f.verify)).rejects.toMatchObject({ code: 'LOGGING_NOT_READY' });
  const adopted = new LoggingCheckpointCustody({ ...f.config, adoptExisting: true }, () => {});
  await adopted.initialize('audit', f.verify); expect(f.retained[0]!.ordinal).toBe(20); await adopted.close();
  expect(() => resolveLoggingCustody({ ...f.config, extra: true })).toThrow();
  expect(() => resolveLoggingCustody({ ...f.config, maxAdoptionProofs: 0 })).toThrow();
});
