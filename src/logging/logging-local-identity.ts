/** Local signing identity. Atomic, private, parent-owned and never silently replaced after evidence exists. */
import { generateKeyPairSync } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareDatabaseRoot, resolveDatabaseFile } from '../databases/database-file';
import type { LoggingCheckpointSigner } from './logging-custody-contracts';
import { createLoggingCheckpointSigner } from './logging-checkpoint-signer';
import { loggingCanonical, loggingId, loggingRecord } from './logging-validation';
import { LoggingError } from './logging-error';

export interface LocalLoggingIdentity { readonly ledgerId: string; readonly signer: LoggingCheckpointSigner }

/** Reading keys uses a no-follow descriptor and bounded bytes, not a pathname-following JSON loader. */
async function readPrivateRecord(path: string): Promise<Record<string, unknown> | null> {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const details = await file.stat();
    if (!details.isFile() || details.nlink !== 1 || details.size < 1 || details.size > 32768
      || process.platform !== 'win32' && (details.mode & 0o077) !== 0) throw new Error();
    return loggingRecord(JSON.parse(await file.readFile('utf8')));
  } finally { await file.close(); }
}

async function readIdentity(path: string): Promise<LocalLoggingIdentity | null> {
  const record = await readPrivateRecord(path); if (record === null) return null;
  const value = loggingRecord(record, ['version', 'ledgerId', 'keyId', 'privateKey', 'publicKeys']);
  if (value.version !== 1 || typeof value.privateKey !== 'string' || value.privateKey.length > 8192) throw new Error();
  return Object.freeze({ ledgerId: loggingId(value.ledgerId)!, signer: createLoggingCheckpointSigner({
    keyId: loggingId(value.keyId)!, privateKey: value.privateKey, publicKeys: value.publicKeys as Readonly<Record<string, string>>,
  }) });
}

/** Caller owns the exclusive Fabric root before reading or rotating an identity. */
export async function openLocalLoggingIdentity(rootDirectory: string, adoptExisting: boolean, desiredKeyId?: string): Promise<LocalLoggingIdentity> {
  let temporary: string | null = null;
  try {
    const root = prepareDatabaseRoot(rootDirectory), identityRoot = prepareDatabaseRoot(join(root, 'identity'));
    const path = join(identityRoot, 'signing.json'), existing = await readIdentity(path);
    const established = await readPrivateRecord(join(identityRoot, 'established.json'));
    if (established) {
      const marker = loggingRecord(established, ['version', 'ledgerId']);
      if (marker.version !== 1 || !existing || marker.ledgerId !== existing.ledgerId
        || !await Bun.file(resolveDatabaseFile(root, 'logging:checkpoints').path).exists()) {
        throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Established logging custody is missing; restore its identity and checkpoint ledger.');
      }
    }
    if (existing && (desiredKeyId === undefined || desiredKeyId === existing.signer.keyId)) return existing;
    // An existing signed ledger must NEVER be adopted under regenerated keys.
    const checkpointPath = resolveDatabaseFile(root, 'logging:checkpoints').path;
    if (!existing && await Bun.file(checkpointPath).exists()) throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Logging signing identity is missing; restore the original identity before continuing.');
    const auditPath = resolveDatabaseFile(root, 'logging:audit').path;
    if (!existing && await Bun.file(auditPath).exists() && !adoptExisting) throw new LoggingError('LOGGING_NOT_READY', 'Existing unsigned logging evidence requires explicit verified adoption.');
    const keyId = desiredKeyId === undefined ? crypto.randomUUID() : loggingId(desiredKeyId)!;
    if (existing && (Object.hasOwn(existing.signer.publicKeys, keyId) || Object.keys(existing.signer.publicKeys).length >= 32)) {
      throw new LoggingError('LOGGING_CONFIG_INVALID', 'Signing rotation requires a new key ID and capacity to retain previous verification keys.');
    }
    const pair = generateKeyPairSync('ed25519');
    const publicKeys = { ...existing?.signer.publicKeys, [keyId]: String(pair.publicKey.export({ type: 'spki', format: 'pem' })) };
    // Reject reserved/malformed key IDs before any existing identity can change.
    createLoggingCheckpointSigner({ keyId, privateKey: pair.privateKey, publicKeys });
    const bytes = loggingCanonical({ version: 1, ledgerId: existing?.ledgerId ?? crypto.randomUUID(), keyId,
      privateKey: String(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      publicKeys });
    temporary = join(identityRoot, 'identity-' + crypto.randomUUID() + '.pending');
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes, 'utf8'); await file.sync(); } finally { await file.close(); }
    // Exclusive hard-link publication never overwrites another owner's completed identity.
    if (existing) await rename(temporary, path);
    else {
      try { await link(temporary, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await unlink(temporary);
    }
    temporary = null;
    const directory = await open(identityRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
    const published = await readIdentity(path); if (!published) throw new Error();
    return published;
  } catch (error) {
    if (error instanceof LoggingError) throw error;
    throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Local logging signing identity could not be opened safely.');
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
  }
}

/** A sticky, private bootstrap marker prevents silently recreating a deleted checkpoint file. */
export async function markLocalLoggingIdentityEstablished(rootDirectory: string, identity: LocalLoggingIdentity): Promise<void> {
  const directoryPath = prepareDatabaseRoot(join(rootDirectory, 'identity')), path = join(directoryPath, 'established.json');
  let pending: string | null = null;
  try {
    const existing = await readPrivateRecord(path);
    if (existing) {
      const value = loggingRecord(existing, ['version', 'ledgerId']);
      if (value.version !== 1 || value.ledgerId !== identity.ledgerId) throw new Error();
      return;
    }
    pending = join(directoryPath, 'established-' + crypto.randomUUID() + '.pending');
    const file = await open(pending, 'wx', 0o600);
    try { await file.writeFile(loggingCanonical({ version: 1, ledgerId: identity.ledgerId })); await file.sync(); }
    finally { await file.close(); }
    await link(pending, path); await unlink(pending); pending = null;
    const directory = await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch { throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Logging custody bootstrap could not be retained safely.'); }
  finally { if (pending) await unlink(pending).catch(() => {}); }
}
