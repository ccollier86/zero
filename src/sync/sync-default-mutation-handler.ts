/** Default ReactiveDB sync.mutate pipeline and acknowledgement projection. */

import type { ServerWebSocket } from 'bun';
import { IdentityProjectionError } from '../auth/identity-projection-error';
import type { PlatformObservabilityRuntime } from '../observability/types';
import {
  withReactiveDBLocalChangeOrigin,
  type ReactiveDB,
} from './reactive-db';
import { evaluateSyncMutationPolicy, type SyncPolicy } from './sync-policy';
import {
  hashSyncMutation,
  type SyncMutationReceiptStore,
} from './sync-mutation-receipt-store';
import { validateSyncMutation } from './sync-mutation-validation';
import { sendSyncWire } from './sync-wire-send';
import {
  SYNC_ACK_ERROR_CODES,
  type Change,
  type Row,
  type SyncAckErrorCode,
  type SyncAckMessage,
  type SyncMutateMessage,
  type SyncResourceMutationScope,
  type SyncResourcePolicyAdapter,
  type SyncSocketData,
  type SyncTableMutationValidator,
} from './types';

/** Plugin-local mutation metadata shared by one transport and change listener. */
export interface SyncMutationOriginContext {
  current: string | null;
}

/**
 * Legacy origin observer for callers that invoke routeMessage() directly.
 * createSyncPlugin supplies an instance-local context and does not read this.
 */
export let currentMutationOrigin: string | null = null;

export type EnsureSyncMutationReady = (input: Readonly<{
  table: string;
  authContext: SyncSocketData['authContext'];
}>) => void | Promise<void>;

export interface DefaultSyncMutationContext {
  readonly db: ReactiveDB;
  readonly policy: SyncPolicy;
  readonly resourcePolicy?: SyncResourcePolicyAdapter;
  readonly receipts?: SyncMutationReceiptStore;
  readonly mutationOrigin?: SyncMutationOriginContext;
  readonly validators?: Readonly<Record<string, SyncTableMutationValidator>>;
  readonly revalidateAuthority?: () => Promise<boolean>;
  readonly validateAuthorityAtCommit?: () => boolean;
  readonly assertCurrentReadAuthority?: () => void;
  readonly observability?: PlatformObservabilityRuntime | null;
  readonly ensureReady?: EnsureSyncMutationReady;
}

/** Validate, authorize, commit, and acknowledge one default-plane mutation. */
export async function handleDefaultSyncMutation(
  socket: ServerWebSocket<SyncSocketData>,
  message: SyncMutateMessage,
  context: DefaultSyncMutationContext,
): Promise<void> {
  const { ref, table, op, rowId, row } = message;
  const {
    db,
    policy,
    resourcePolicy,
    receipts,
    mutationOrigin,
    validators,
    revalidateAuthority,
    validateAuthorityAtCommit,
    assertCurrentReadAuthority = () => undefined,
    observability,
    ensureReady,
  } = context;

  if (!ref || typeof ref !== 'string' || ref.length > 128) return;
  if (!table || typeof table !== 'string') return;
  if (!op || !['INSERT', 'UPDATE', 'DELETE'].includes(op)) return;
  if (message.epoch !== undefined && typeof message.epoch !== 'string') return;
  if (message.plane !== undefined
    && message.plane !== 'default'
    && message.plane !== 'tenant') return;
  if (message.attempt !== undefined
    && (!Number.isSafeInteger(message.attempt) || message.attempt < 1)) return;

  if (!db.hasTable(table)) {
    sendAck(socket, ref, false, null, `Unknown table: ${table}`);
    return;
  }

  const principal = mutationPrincipal(socket);
  const requestHash = hashSyncMutation(message);
  const receipt = receipts?.find(principal, ref, requestHash);
  if (receipt?.status === 'conflict') {
    sendAck(socket, ref, false, null, 'Mutation reference conflict');
    return;
  }
  if (receipt?.status === 'hit') {
    sendResolvedAck(socket, db, receipt.ack, assertCurrentReadAuthority);
    return;
  }

  if ((message.attempt ?? 1) > 1
    || (message.epoch && message.epoch !== db.syncEpoch)) {
    sendAck(socket, ref, false, null, 'Mutation outcome unavailable; retry as new work');
    return;
  }

  const policyDecision = evaluateSyncMutationPolicy(policy, {
    table,
    op,
    rowId,
    row,
    authContext: socket.data.authContext,
  }, observability);
  if (!policyDecision.ok) {
    sendAck(
      socket,
      ref,
      false,
      null,
      policyDecision.reason ?? `Not allowed: ${table}`,
    );
    return;
  }

  let mutationRow = row;
  let mutationScope: SyncResourceMutationScope | undefined;
  let mutationExpectedRow: Row | undefined;
  let mutationCreateOnly = false;
  let mutationAuthorityFingerprint: string | undefined;
  if (op === 'INSERT') {
    if (!mutationRow || typeof mutationRow !== 'object') {
      sendAck(socket, ref, false, null, 'INSERT requires a row');
      return;
    }
  } else if (op === 'UPDATE') {
    if (!rowId || typeof rowId !== 'string') {
      sendAck(socket, ref, false, null, 'UPDATE requires rowId');
      return;
    }
    if (!mutationRow || typeof mutationRow !== 'object') {
      sendAck(socket, ref, false, null, 'UPDATE requires row (partial)');
      return;
    }
  } else if (!rowId || typeof rowId !== 'string') {
    sendAck(socket, ref, false, null, 'DELETE requires rowId');
    return;
  }

  if (resourcePolicy) {
    const resourceDecision = await resourcePolicy.authorizeMutation({
      table,
      op,
      rowId,
      row: mutationRow,
      authContext: socket.data.authContext,
      loadRow: (tableName, id) => db.get(tableName, id),
    });

    if (!resourceDecision.ok) {
      sendAck(socket, ref, false, null, resourceDecision.reason);
      return;
    }

    if (resourceDecision.row !== undefined) {
      mutationRow = resourceDecision.row;
    }
    mutationScope = resourceDecision.scope;
    mutationExpectedRow = resourceDecision.expectedRow;
    mutationCreateOnly = resourceDecision.createOnly ?? false;
    mutationAuthorityFingerprint = resourceDecision.authorityFingerprint;
  }

  // Custom resource policies may yield. Re-resolve live auth immediately
  // before the remaining synchronous write boundary.
  if (revalidateAuthority && !await revalidateAuthority()) {
    sendAck(socket, ref, false, null, 'Authorization changed during mutation');
    return;
  }

  if (ensureReady && op !== 'DELETE') {
    try {
      await ensureReady({ table, authContext: socket.data.authContext });
    } catch (error) {
      if (!(error instanceof IdentityProjectionError)) throw error;
      const unavailable = !error.retryable;
      sendAck(
        socket,
        ref,
        false,
        null,
        unavailable
          ? 'Application data realm is unavailable'
          : 'Application data realm is not ready',
        unavailable
          ? SYNC_ACK_ERROR_CODES.dataRealmUnavailable
          : SYNC_ACK_ERROR_CODES.dataRealmNotReady,
      );
      return;
    }
    // Anchor reconciliation may yield. Never let authority captured by policy
    // cross that wait without another live session/RBAC comparison.
    if (revalidateAuthority && !await revalidateAuthority()) {
      sendAck(socket, ref, false, null, 'Authorization changed during mutation');
      return;
    }
  }

  const validation = validateSyncMutation(
    db,
    table,
    op,
    rowId,
    mutationRow,
    validators?.[table],
  );
  if (!validation.ok) {
    sendAck(socket, ref, false, null, validation.error);
    return;
  }
  mutationRow = validation.row;

  try {
    let ack: SyncAckMessage | undefined;
    const previousOrigin = mutationOrigin
      ? mutationOrigin.current
      : currentMutationOrigin;
    if (mutationOrigin) {
      mutationOrigin.current = socket.data.connectionId;
    } else {
      currentMutationOrigin = socket.data.connectionId;
    }
    try {
      withReactiveDBLocalChangeOrigin(
        db,
        socket.data.connectionId,
        () => db.transaction(() => {
          if (validateAuthorityAtCommit && !validateAuthorityAtCommit()) {
            throw new Error('Authorization changed during mutation');
          }
          if (mutationAuthorityFingerprint
            && !(resourcePolicy?.validateMutationAuthorityAtCommit?.(
              socket.data.authContext,
              mutationAuthorityFingerprint,
            ) ?? true)) {
            throw new Error('Authorization changed during mutation');
          }
          const raced = receipts?.find(principal, ref, requestHash);
          if (raced?.status === 'conflict') {
            throw new Error('Mutation reference conflict');
          }
          if (raced?.status === 'hit') {
            ack = raced.ack;
            return;
          }
          const change = applyMutation(
            db,
            table,
            op,
            rowId,
            mutationRow,
            mutationScope,
            mutationExpectedRow,
            mutationCreateOnly,
          );
          ack = createSuccessAck(ref, change);
          receipts?.save(principal, ref, requestHash, ack);
        }),
      );
    } finally {
      if (mutationOrigin) {
        mutationOrigin.current = previousOrigin;
      } else {
        currentMutationOrigin = previousOrigin;
      }
    }
    if (ack) sendResolvedAck(socket, db, ack, assertCurrentReadAuthority);
  } catch (error) {
    sendAck(socket, ref, false, null, safeDefaultMutationError(error));
  }
}

/** Keep raw SQLite/extension errors out of the Sync wire contract. */
function safeDefaultMutationError(error: unknown): string {
  if (isDatabaseAuthorityChanged(error)) {
    return 'Authorization changed during mutation';
  }
  if (!(error instanceof Error)) return 'Mutation failed';
  if (error.message === 'Authorization changed during mutation') {
    return 'Authorization changed during mutation';
  }
  if (error.message === 'Mutation reference conflict') {
    return 'Mutation reference conflict';
  }
  if (error.message.startsWith('Row not found: ')) return 'Row not found';
  if (/^(?:createStrict|createScoped)\('[A-Za-z0-9_]+'\): primary key already exists$/u
    .test(error.message)) {
    return 'primary key already exists';
  }
  if (/^(?:updateIfCurrent|updateScoped|deleteIfCurrent|deleteScoped)\('[A-Za-z0-9_]+'\): row changed since authorization$/u
    .test(error.message)) {
    return 'row changed since authorization';
  }
  return 'Mutation failed';
}

function applyMutation(
  db: ReactiveDB,
  table: string,
  op: SyncMutateMessage['op'],
  rowId: string | undefined,
  row: Row | Partial<Row> | undefined,
  scope?: SyncResourceMutationScope,
  expectedRow?: Row,
  createOnly = false,
): Change {
  if (op === 'INSERT') {
    return scope
      ? db.createScoped(table, row as Row, scope)
      : createOnly
        ? db.createStrict(table, row as Row)
        : db.insert(table, row as Row);
  }
  const change = op === 'UPDATE'
    ? scope
      ? db.updateScoped(table, rowId!, row as Partial<Row>, scope, expectedRow)
      : expectedRow
        ? db.updateIfCurrent(table, rowId!, row as Partial<Row>, expectedRow)
        : db.update(table, rowId!, row as Partial<Row>)
    : scope
      ? db.deleteScoped(table, rowId!, scope, expectedRow)
      : expectedRow
        ? db.deleteIfCurrent(table, rowId!, expectedRow)
        : db.delete(table, rowId!);
  if (!change) throw new Error(`Row not found: ${rowId!}`);
  return change;
}

function createSuccessAck(ref: string, change: Change): SyncAckMessage {
  return {
    type: 'sync.ack',
    ref,
    seq: change.seq,
    ok: true,
    change: {
      table: change.table,
      op: change.op,
      rowId: change.rowId,
      row: change.row,
    },
  };
}

function mutationPrincipal(socket: ServerWebSocket<SyncSocketData>): string {
  return socket.data.authContext
    ? `user:${socket.data.authContext.userId}:scope:${socket.data.authorizationScope ?? 'unresolved'}`
    : `anonymous:${socket.data.authorizationScope ?? 'public'}`;
}

function sendResolvedAck(
  socket: ServerWebSocket<SyncSocketData>,
  db: ReactiveDB,
  ack: SyncAckMessage,
  assertCurrentReadAuthority: () => void = () => undefined,
): void {
  if (!ack.change) return void sendSyncWire(socket, ack);
  try {
    const { table, rowId } = ack.change;
    const row = db.get(table, rowId);
    const readable = socket.data.allowedTables.has(table);
    const matches = readable && row
      ? socket.data.resourceRowFilters.get(table)?.matches(row) ?? true
      : false;
    const projectedRow = matches && row
      ? socket.data.resourceRowProjectors?.get(table)?.project(row) ?? row
      : null;
    // Filters/projectors are trusted extension code. Fence their row-bearing
    // acknowledgement at the final synchronous edge, like live delivery.
    assertCurrentReadAuthority();
    sendSyncWire(socket, {
      ...ack,
      ...(socket.data.syncMultiplexed ? { plane: 'default' as const } : {}),
      seq: db.currentSeq,
      change: projectedRow
        ? { table, rowId, op: 'UPDATE', row: projectedRow }
        : { table, rowId, op: 'DELETE', row: null },
    });
  } catch (error) {
    // The managed assertion has already closed/reset the socket. The mutation
    // is durable, so never fabricate a definitive negative acknowledgement.
    if (isDatabaseAuthorityChanged(error)) return;
    closeAfterCommittedAckFailure(socket);
  }
}

function isDatabaseAuthorityChanged(error: unknown): boolean {
  return Boolean(error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === 'DATABASE_AUTHORITY_CHANGED');
}

function closeAfterCommittedAckFailure(
  socket: ServerWebSocket<SyncSocketData>,
): void {
  try {
    socket.close(1011, 'Sync acknowledgement projection failed');
  } catch {
    // The receipt still makes the commit recoverable if close also fails.
  }
}

function sendAck(
  socket: ServerWebSocket<SyncSocketData>,
  ref: string,
  ok: boolean,
  seq: number | null,
  error?: string,
  errorCode?: SyncAckErrorCode,
): void {
  const ack: SyncAckMessage = { type: 'sync.ack', ref, seq, ok };
  if (socket.data.syncMultiplexed) ack.plane = 'default';
  if (error) ack.error = error;
  if (errorCode) ack.errorCode = errorCode;
  sendSyncWire(socket, ack);
}
