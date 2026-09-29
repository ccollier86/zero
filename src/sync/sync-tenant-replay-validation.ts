/**
 * Trust boundary for tenant-Sync actor replay and mutation receipt results.
 *
 * Actor values are treated as untrusted structured data here before they can
 * advance a socket cursor or become an acknowledgement.
 */

import type {
  DatabaseCommitResult,
  DatabaseMutation,
} from '../databases/database-operations';
import type {
  SyncTenantDataPlaneReplay,
  SyncTenantMutationReceiptReplay,
} from './sync-tenant-data-plane-contract';
import type { Change, Row } from './types';

export function canonicalChangeFromCommit(
  result: DatabaseCommitResult,
  expected?: DatabaseMutation,
): Change {
  if (!plainRecord(result.value)) throw invalidCommit();
  const value = result.value as Record<string, any>;
  const effects = value.kind === 'mutation'
    ? [value.mutation]
    : value.kind === 'batch' && Array.isArray(value.mutations)
      ? value.mutations
      : null;
  if (!effects || effects.length !== 1 || !plainRecord(effects[0])) {
    throw invalidCommit();
  }
  const effect = effects[0];
  const sequence = plainRecord(effect.sequence) ? effect.sequence.seq : null;
  const resultSequence = plainRecord(result.sequence) ? result.sequence.seq : null;
  if ((expected && effect.table !== expected.table)
    || effect.changed !== true
    || !Number.isSafeInteger(sequence)
    || (sequence as number) < 1
    || resultSequence !== sequence
    || (effect.op !== 'INSERT' && effect.op !== 'UPDATE' && effect.op !== 'DELETE')
    || typeof effect.rowId !== 'string'
    || effect.rowId.length === 0
    || !Object.hasOwn(effect, 'row')
    || !Object.hasOwn(effect, 'previousRow')) {
    throw invalidCommit();
  }
  const row = effect.row;
  const previousRow = effect.previousRow;
  if ((effect.op === 'DELETE' ? row !== null : !plainRecord(row))
    || (effect.op === 'INSERT'
      ? previousRow !== null
      : !plainRecord(previousRow))) {
    throw invalidCommit();
  }
  if (expected) assertExpectedMutationEffect(effect, expected);
  return {
    seq: sequence as number,
    table: effect.table as string,
    op: effect.op,
    rowId: effect.rowId,
    row: row as Row | null,
    previousRow: previousRow as Row | null,
    ts: Number.isSafeInteger(effect.ts) && (effect.ts as number) >= 0
      ? effect.ts as number
      : Date.now(),
  };
}

export function validateTenantReplayPage(
  replay: SyncTenantDataPlaneReplay,
  afterSeq: number,
): void {
  if (replay.value.afterSeq !== afterSeq
    || !Number.isSafeInteger(replay.sequence.seq)
    || replay.sequence.seq < afterSeq
    || !Number.isSafeInteger(replay.value.throughSeq)
    || replay.value.throughSeq < afterSeq) throw tenantHistoryGapError();
  let cursor = afterSeq;
  for (const change of replay.value.changes) {
    if (change.seq !== cursor + 1) throw tenantHistoryGapError();
    cursor = change.seq;
  }
  if (replay.value.throughSeq !== cursor
    || (replay.value.nextAfterSeq !== null
      && replay.value.nextAfterSeq !== cursor)
    || (replay.value.nextAfterSeq === null
      ? replay.value.throughSeq !== replay.sequence.seq
      : replay.value.throughSeq >= replay.sequence.seq)) throw tenantHistoryGapError();
}

export function assertExpectedTenantReceiptChange(
  change: Change,
  expected: SyncTenantMutationReceiptReplay['expected'],
): void {
  const operationMatches = expected.op === 'INSERT'
    ? change.op === 'INSERT' || change.op === 'UPDATE'
    : change.op === expected.op;
  if (change.table !== expected.table
    || !operationMatches
    || (expected.rowId !== undefined && change.rowId !== expected.rowId)) {
    throw invalidCommit();
  }
}

export function tenantHistoryGapError(): Error & { code: string } {
  return Object.assign(new Error('Tenant Sync history is unavailable'), {
    code: 'DATABASE_HISTORY_GAP',
  });
}

function assertExpectedMutationEffect(
  effect: Record<string, any>,
  expected: DatabaseMutation,
): void {
  if (effect.type !== expected.type) throw invalidCommit();
  if (expected.type === 'update') {
    if (effect.op !== 'UPDATE' || effect.rowId !== expected.id) throw invalidCommit();
    return;
  }
  if (expected.type === 'delete') {
    if (effect.op !== 'DELETE' || effect.rowId !== expected.id) throw invalidCommit();
    return;
  }
  if (expected.type === 'create' && effect.op !== 'INSERT') throw invalidCommit();
}

function invalidCommit(): Error {
  return new Error('Tenant Sync actor returned an invalid canonical mutation receipt');
}

function plainRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
