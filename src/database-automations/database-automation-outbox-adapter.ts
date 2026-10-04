/**
 * database-automation-outbox-adapter.ts
 *
 * Maps the transaction runtime's durable-effect contract into the exact
 * source-local outbox record. It validates correlation and deployment binding;
 * it does not claim or execute host work.
 */

import { DatabaseError } from '../databases/database-error';
import type { DatabaseAutomationRegistry } from './database-automations';
import type {
  DatabaseDurableAutomationEnqueueInput,
  DatabaseDurableAutomationSink,
} from './database-automation-runtime-contracts';
import type { DatabaseAutomationOutboxStore } from './automation-outbox-store';

export interface DatabaseAutomationOutboxAdapterOptions {
  readonly store: DatabaseAutomationOutboxStore;
  readonly registry: DatabaseAutomationRegistry;
  readonly realmName: string;
  readonly realmFingerprint: string;
}

/** Build a synchronous sink which joins the originating ReactiveDB commit. */
export function createDatabaseAutomationOutboxAdapter(
  options: DatabaseAutomationOutboxAdapterOptions,
): DatabaseDurableAutomationSink {
  return Object.freeze({
    enqueue(input: DatabaseDurableAutomationEnqueueInput): void {
      assertEnqueueContract(options.registry, input);
      const triggerIdentity = input.invocation.triggerIdentity!;
      options.store.enqueue({
        deliveryId: input.deliveryId,
        invocationId: input.invocation.invocationId,
        triggerIdentity,
        functionIdentity: input.invocation.functionIdentity,
        manifestFingerprint: options.registry.fingerprint,
        realmName: options.realmName,
        realmFingerprint: options.realmFingerprint,
        sourceSequence: input.input.change.sequence,
        sourceTable: input.input.change.table,
        sourceOperation: input.input.change.operation,
        sourceRowId: input.input.change.rowId,
        input: input.input,
        availableAt: input.availableAt,
      }, input.availableAt);
    },
  });
}

function assertEnqueueContract(
  registry: DatabaseAutomationRegistry,
  input: DatabaseDurableAutomationEnqueueInput,
): void {
  const invocation = input.invocation;
  const change = input.input.change;
  const definition = registry.getFunction(invocation.functionIdentity);
  const trigger = invocation.triggerIdentity === null
    ? null
    : registry.getTrigger(invocation.triggerIdentity);
  if (input.automationFingerprint !== registry.fingerprint
    || !definition
    || definition.mode !== 'durable'
    || !trigger
    || trigger.table !== change.table
    || invocation.table !== change.table
    || invocation.operation !== change.operation
    || !trigger.run.some(({ identity }) => identity === definition.identity)) {
    throw new DatabaseError(
      'DATABASE_PROTOCOL_ERROR',
      'Database automation durable-effect contract is inconsistent.',
      {
        retryable: false,
        outcome: 'not-committed',
        details: { phase: 'automation-outbox-adapter' },
      },
    );
  }
}
