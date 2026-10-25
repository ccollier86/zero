/** Built-in checkpoint custody over a separate private Fabric capability, not the event database. */
import type { AsyncDatabaseClient, DatabaseSerializableValue } from '../databases/database-operations';
import type { LocalLoggingIdentity } from './logging-local-identity';
import type { LocalLoggingCustodyConfig, LoggingCustodyConfig, LoggingCustodyStore } from './logging-custody-contracts';
import { checkpointDigest, verifySignedCheckpoint } from './logging-checkpoint-signer';
import { loggingRecord } from './logging-validation';
import { LoggingError } from './logging-error';

export function createLocalLoggingCustody(data: AsyncDatabaseClient, identity: LocalLoggingIdentity, options: LocalLoggingCustodyConfig): LoggingCustodyConfig {
  const store = Object.freeze({ identity: 'zero.local.checkpoints',
    async read(ledgerId, stream, signal) {
      signal.throwIfAborted();
      if (ledgerId !== identity.ledgerId) throw new LoggingError('LOGGING_CONFIG_INVALID', 'Checkpoint ledger identity does not match.');
      const result = await data.query('logging.checkpoint.read', { ledgerId, stream }, { consistency: { mode: 'strong' }, signal });
      signal.throwIfAborted();
      return result.value === null ? null : verifySignedCheckpoint(result.value, ledgerId, stream, identity.signer.publicKeys);
    },
    async append(checkpoint, expectedDigest, signal) {
      signal.throwIfAborted();
      const cp = verifySignedCheckpoint(checkpoint, identity.ledgerId, checkpoint.stream, identity.signer.publicKeys);
      const result = await data.command('logging.checkpoint.append', { checkpoint: cp, expectedDigest } as unknown as DatabaseSerializableValue,
        { idempotencyKey: 'checkpoint:' + checkpointDigest(cp), signal });
      const wrapped = loggingRecord(result.value, ['kind', 'name', 'output']);
      if (wrapped.kind !== 'command' || wrapped.name !== 'logging.checkpoint.append') throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Checkpoint acknowledgment is invalid.', 'unknown');
      signal.throwIfAborted();
      return verifySignedCheckpoint(wrapped.output, identity.ledgerId, cp.stream, identity.signer.publicKeys);
    },
  } satisfies LoggingCustodyStore);
  return Object.freeze({ adoptExisting: options.adoptExisting, maxAdoptionProofs: options.maxAdoptionProofs,
    maxVerificationProofs: options.maxVerificationProofs, ledgerId: identity.ledgerId, signer: identity.signer, store });
}
