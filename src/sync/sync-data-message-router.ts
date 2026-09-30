/** Routes durable Sync messages across the default, system, and tenant planes. */

import type { ServerWebSocket } from 'bun';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { ReactiveDB } from './reactive-db';
import {
  handleDefaultSyncMutation,
  type EnsureSyncMutationReady,
  type SyncMutationOriginContext,
} from './sync-default-mutation-handler';
import type { SyncMutationReceiptStore } from './sync-mutation-receipt-store';
import { handleSyncSubscribe } from './sync-subscribe-handler';
import type { SyncSystemSocketBridge } from './sync-system-data-plane';
import type { SyncTenantSocketBridge } from './sync-tenant-data-plane';
import { handleTenantSyncMutation } from './sync-tenant-mutation';
import type {
  SyncMutateMessage,
  SyncResourcePolicyAdapter,
  SyncSocketData,
  SyncSubscribeMessage,
  SyncTableMutationValidator,
} from './types';
import type { SyncPolicy } from './sync-policy';

type ParsedSyncMessage = { type: string; [key: string]: unknown };

export interface SyncDataMessageContext {
  readonly db: ReactiveDB;
  readonly policy: SyncPolicy;
  readonly snapshotTables?: Set<string>;
  readonly resourcePolicy?: SyncResourcePolicyAdapter;
  readonly mutationReceipts?: SyncMutationReceiptStore;
  readonly mutationOrigin?: SyncMutationOriginContext;
  readonly mutationValidators?: Readonly<Record<string, SyncTableMutationValidator>>;
  readonly revalidateMutationAuthority?: () => Promise<boolean>;
  readonly validateMutationAuthorityAtCommit?: () => boolean;
  readonly tenantDataPlane?: SyncTenantSocketBridge;
  readonly systemDataPlane?: SyncSystemSocketBridge;
  readonly observability?: PlatformObservabilityRuntime | null;
  readonly assertCurrentReadAuthority?: () => void;
  readonly ensureMutationReady?: EnsureSyncMutationReady;
}

export function isSyncDataMessage(message: ParsedSyncMessage): boolean {
  return message.type === 'sync.subscribe' || message.type === 'sync.mutate';
}

/** Route one already-parsed durable Sync message. */
export async function routeSyncDataMessage(
  socket: ServerWebSocket<SyncSocketData>,
  message: ParsedSyncMessage,
  context: SyncDataMessageContext,
): Promise<void> {
  if (message.type === 'sync.subscribe') {
    await handleSubscribe(
      socket,
      message as unknown as SyncSubscribeMessage,
      context,
    );
    return;
  }
  if (message.type === 'sync.mutate') {
    await handleMutation(
      socket,
      message as unknown as SyncMutateMessage,
      context,
    );
  }
}

async function handleSubscribe(
  socket: ServerWebSocket<SyncSocketData>,
  message: SyncSubscribeMessage,
  context: SyncDataMessageContext,
): Promise<void> {
  const {
    db,
    snapshotTables,
    tenantDataPlane,
    systemDataPlane,
    observability,
    assertCurrentReadAuthority = () => undefined,
  } = context;
  if (!systemDataPlane?.ownsAnyTable(message.tables)
    && !tenantDataPlane?.ownsAnyTable(message.tables)) {
    systemDataPlane?.clearSubscription();
    if (tenantDataPlane) await tenantDataPlane.clearSubscription();
    socket.data.syncMultiplexed = false;
    await handleSyncSubscribe(
      socket,
      message,
      db,
      snapshotTables,
      observability,
      assertCurrentReadAuthority,
    );
    return;
  }

  const tables = partitionSubscriptionTables(message, context);
  socket.data.syncMultiplexed = tables.mixed;
  if (tables.mixed) {
    await handleSyncSubscribe(
      socket,
      planeSubscribeMessage(message, 'default', tables.default, true),
      db,
      snapshotTables,
      observability,
      assertCurrentReadAuthority,
    );
  } else {
    socket.data.syncSubscribedTables.clear();
    socket.data.rowFilteredSubscribedTables.clear();
  }

  if (tables.system.length > 0) {
    await systemDataPlane!.subscribe(
      planeSubscribeMessage(message, 'system', tables.system, tables.mixed),
    );
  } else {
    systemDataPlane?.clearSubscription();
  }
  if (tables.tenant.length > 0) {
    await tenantDataPlane!.subscribe(
      planeSubscribeMessage(message, 'tenant', tables.tenant, tables.mixed),
    );
  } else if (tenantDataPlane) {
    await tenantDataPlane.clearSubscription();
  }
}

async function handleMutation(
  socket: ServerWebSocket<SyncSocketData>,
  message: SyncMutateMessage,
  context: SyncDataMessageContext,
): Promise<void> {
  const {
    db,
    policy,
    resourcePolicy,
    mutationReceipts,
    mutationOrigin,
    mutationValidators,
    revalidateMutationAuthority,
    validateMutationAuthorityAtCommit,
    tenantDataPlane,
    systemDataPlane,
    observability,
    assertCurrentReadAuthority = () => undefined,
    ensureMutationReady,
  } = context;

  if (systemDataPlane?.ownsTable(message.table)) {
    if (!matchesPlane(message.plane, 'system')) {
      closePlaneMismatch(socket);
      return;
    }
    systemDataPlane.rejectMutation(message.ref);
    return;
  }
  if (tenantDataPlane?.ownsTable(message.table)) {
    if (!matchesPlane(message.plane, 'tenant')) {
      closePlaneMismatch(socket);
      return;
    }
    await handleTenantSyncMutation(
      socket,
      message,
      tenantDataPlane,
      policy,
      resourcePolicy,
      mutationValidators,
      revalidateMutationAuthority,
      assertCurrentReadAuthority,
      observability,
    );
    return;
  }
  if (!matchesPlane(message.plane, 'default')) {
    closePlaneMismatch(socket);
    return;
  }
  await handleDefaultSyncMutation(socket, message, {
    db,
    policy,
    resourcePolicy,
    receipts: mutationReceipts,
    mutationOrigin,
    validators: mutationValidators,
    revalidateAuthority: revalidateMutationAuthority,
    validateAuthorityAtCommit: validateMutationAuthorityAtCommit,
    assertCurrentReadAuthority,
    observability,
    ensureReady: ensureMutationReady,
  });
}

function partitionSubscriptionTables(
  message: SyncSubscribeMessage,
  context: SyncDataMessageContext,
): Readonly<{
  default: string[];
  system: string[];
  tenant: string[];
  mixed: boolean;
}> {
  const requested = Array.isArray(message.tables) ? message.tables : [];
  const system = requested.filter(
    (table): table is string => context.systemDataPlane?.ownsTable(table) ?? false,
  );
  const tenant = requested.filter(
    (table): table is string => context.tenantDataPlane?.ownsTable(table) ?? false,
  );
  const defaults = requested.filter((table): table is string => (
    typeof table === 'string'
    && !(context.systemDataPlane?.ownsTable(table) ?? false)
    && !(context.tenantDataPlane?.ownsTable(table) ?? false)
    && context.db.hasTable(table)
  ));
  const mixed = [defaults, system, tenant]
    .filter((planeTables) => planeTables.length > 0).length > 1;
  return { default: defaults, system, tenant, mixed };
}

function planeSubscribeMessage(
  message: SyncSubscribeMessage,
  plane: 'default' | 'system' | 'tenant',
  tables: readonly string[],
  mixed: boolean,
): SyncSubscribeMessage {
  const cursor = message.cursors?.[plane];
  // Top-level cursor fields remain the default/single-plane compatibility
  // contract. An old mixed client safely gets a fresh non-default baseline.
  const useLegacy = plane === 'default' || !mixed;
  const lastSeq = cursor?.lastSeq ?? (useLegacy ? message.lastSeq : 0);
  const epoch = cursor?.epoch ?? (useLegacy ? message.epoch : undefined);
  const scope = cursor && Object.hasOwn(cursor, 'scope')
    ? cursor.scope
    : useLegacy ? message.scope : undefined;
  const requestedSnapshot = new Set(message.snapshot ?? []);
  return {
    ...message,
    tables: [...tables],
    snapshot: tables.filter((table) => requestedSnapshot.has(table)),
    lastSeq,
    ...(epoch === undefined ? { epoch: undefined } : { epoch }),
    ...(scope === undefined ? { scope: undefined } : { scope }),
  };
}

function matchesPlane(
  requested: SyncMutateMessage['plane'],
  owned: 'default' | 'system' | 'tenant',
): boolean {
  return requested === undefined || requested === owned;
}

function closePlaneMismatch(socket: ServerWebSocket<SyncSocketData>): void {
  socket.close(1008, 'Sync mutation plane does not match its table');
}
