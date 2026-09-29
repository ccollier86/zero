/** Actor-backed sync.mutate authorization, validation, and acknowledgement. */

import type { ServerWebSocket } from 'bun';
import type {
  DatabaseAssertion,
  DatabaseOperationRow,
} from '../databases/database-operations';
import { evaluateSyncMutationPolicy, type SyncPolicy } from './sync-policy';
import {
  createTenantDatabaseMutation,
  createTenantSyncIdempotencyKey,
  createTenantSyncLogicalReceiptFingerprint,
  isExpiredTenantSyncMutationReceipt,
  requiresTenantSyncMutationRecovery,
  type SyncTenantSocketBridge,
} from './sync-tenant-data-plane';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type {
  Row,
  SyncMutateMessage,
  SyncResourceMutationScope,
  SyncResourcePolicyAdapter,
  SyncSocketData,
  SyncTableMutationValidator,
} from './types';
import {
  tenantMutationMatchesScope,
  validateTenantMutationRow,
  validTenantMutationRequest,
} from './sync-tenant-mutation-validation';
import {
  isTenantSyncMutationCapacityExhausted,
  safeTenantMutationError,
  sendExpiredTenantMutationReceiptAck,
  sendTenantAck,
  sendTenantCanonicalAck,
  sendTenantMutationCapacityExhaustedAck,
} from './sync-tenant-mutation-response';

/** Handle a mutation whose table belongs to the physical tenant plane. */
export async function handleTenantSyncMutation(
  socket: ServerWebSocket<SyncSocketData>,
  message: SyncMutateMessage,
  bridge: SyncTenantSocketBridge,
  policy: SyncPolicy,
  resourcePolicy?: SyncResourcePolicyAdapter,
  mutationValidators?: Readonly<Record<string, SyncTableMutationValidator>>,
  revalidateMutationAuthority?: () => Promise<boolean>,
  assertCurrentReadAuthority: () => void = () => undefined,
  observability?: PlatformObservabilityRuntime | null,
): Promise<void> {
  if (!validTenantMutationRequest(message)) return;
  const { ref, table, op, rowId } = message;
  if (!bridge.ownsTable(table)) return;
  if (!socket.data.allowedTables.has(table)) {
    sendTenantAck(socket, ref, false, null, `Not allowed: ${table}`);
    return;
  }

  const policyDecision = evaluateSyncMutationPolicy(policy, {
    table,
    op,
    rowId,
    row: message.row,
    authContext: socket.data.authContext,
  }, observability);
  if (!policyDecision.ok) {
    sendTenantAck(socket, ref, false, null, policyDecision.reason ?? `Not allowed: ${table}`);
    return;
  }

  const auth = socket.data.authContext;
  if (!auth) {
    sendTenantAck(socket, ref, false, null, 'Tenant Sync requires authentication');
    return;
  }
  const idempotencyKey = createTenantSyncIdempotencyKey(auth, ref);
  const logicalReceiptFingerprint = createTenantSyncLogicalReceiptFingerprint(message);

  // Resolve a durable receipt before row policy performs any current-row read.
  // This is essential for exact UPDATE/DELETE replay after the original CAS
  // row has changed or disappeared.
  try {
    const replayed = await bridge.replayMutationReceipt({
      idempotencyKey,
      logicalReceiptFingerprint,
      expected: {
        table,
        op,
        ...(rowId === undefined ? {} : { rowId }),
      },
      async authorize(change) {
        if (resourcePolicy) {
          const decision = await resourcePolicy.authorizeMutation({
            table,
            op,
            rowId,
            row: message.row,
            authContext: socket.data.authContext,
            loadRow: (name, id) => (
              name === table && id === change.rowId
                ? change.previousRow ?? null
                : null
            ),
          });
          if (!decision.ok) return false;
          if (decision.authorityFingerprint
            && !(resourcePolicy.validateMutationAuthorityAtCommit?.(
              socket.data.authContext,
              decision.authorityFingerprint,
            ) ?? true)) return false;
        }
        return revalidateMutationAuthority
          ? await revalidateMutationAuthority()
          : true;
      },
      acknowledge: (change) => sendTenantCanonicalAck(
        socket,
        ref,
        table,
        change,
        assertCurrentReadAuthority,
      ),
    });
    if (replayed) return;
  } catch (error) {
    if (isExpiredTenantSyncMutationReceipt(error)) {
      sendExpiredTenantMutationReceiptAck(socket, ref);
      return;
    }
    if (isTenantSyncMutationCapacityExhausted(error)) {
      sendTenantMutationCapacityExhaustedAck(socket, ref);
      return;
    }
    if (requiresTenantSyncMutationRecovery(error)) {
      bridge.recoverUnacknowledgedMutation();
      return;
    }
    sendTenantAck(socket, ref, false, null, safeTenantMutationError(error));
    return;
  }

  let mutationRow = message.row;
  let expectedRow: Row | undefined;
  let scope: SyncResourceMutationScope | undefined;
  let createOnly = false;
  let authorityFingerprint: string | undefined;
  if (resourcePolicy) {
    const decision = await resourcePolicy.authorizeMutation({
      table,
      op,
      rowId,
      row: mutationRow,
      authContext: socket.data.authContext,
      loadRow: (name, id) => bridge.loadRow(name, id),
    });
    if (!decision.ok) {
      sendTenantAck(socket, ref, false, null, decision.reason);
      return;
    }
    if (decision.row !== undefined) mutationRow = decision.row;
    expectedRow = decision.expectedRow;
    scope = decision.scope;
    createOnly = decision.createOnly ?? false;
    authorityFingerprint = decision.authorityFingerprint;
  }

  if (revalidateMutationAuthority && !await revalidateMutationAuthority()) {
    sendTenantAck(socket, ref, false, null, 'Authorization changed during mutation');
    return;
  }

  const validation = await validateTenantMutationRow(
    bridge,
    table,
    op,
    rowId,
    mutationRow,
    mutationValidators?.[table],
    expectedRow,
  );
  if (!validation.ok) {
    sendTenantAck(socket, ref, false, null, validation.error);
    return;
  }
  mutationRow = validation.row;
  expectedRow = validation.existing;

  if (!tenantMutationMatchesScope(op === 'INSERT' ? mutationRow : expectedRow, scope)) {
    sendTenantAck(socket, ref, false, null, `Row not found: ${rowId ?? ''}`);
    return;
  }

  const assertions: DatabaseAssertion[] = [];
  if (expectedRow && rowId && op !== 'INSERT') {
    assertions.push({
      type: 'row-equals',
      table,
      id: rowId,
      row: expectedRow as DatabaseOperationRow,
    });
  }
  const tableDefinition = bridge.table(table)!;
  if (op === 'INSERT' && createOnly) {
    const id = mutationRow?.[tableDefinition.primaryKey];
    if (typeof id === 'string' && id.length > 0) {
      assertions.push({ type: 'row-missing', table, id });
    } else if (typeof id === 'number' && Number.isSafeInteger(id)) {
      assertions.push({ type: 'row-missing', table, id: String(id) });
    }
  }

  try {
    await bridge.commit({
      mutation: createTenantDatabaseMutation({
        table,
        op,
        rowId,
        row: mutationRow,
      }, createOnly),
      ...(assertions.length > 0 ? { assertions } : {}),
      idempotencyKey,
      logicalReceiptFingerprint,
      ...(authorityFingerprint ? { authorityFingerprint } : {}),
      acknowledge: (change) => sendTenantCanonicalAck(
        socket,
        ref,
        table,
        change,
        assertCurrentReadAuthority,
      ),
    });
  } catch (error) {
    if (isExpiredTenantSyncMutationReceipt(error)) {
      sendExpiredTenantMutationReceiptAck(socket, ref);
      return;
    }
    if (isTenantSyncMutationCapacityExhausted(error)) {
      sendTenantMutationCapacityExhaustedAck(socket, ref);
      return;
    }
    if (requiresTenantSyncMutationRecovery(error)) {
      bridge.recoverUnacknowledgedMutation();
      return;
    }
    sendTenantAck(socket, ref, false, null, safeTenantMutationError(error));
  }
}
