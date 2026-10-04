import type {
  ServerMessage,
  SyncDataPlaneName,
  SyncMutationRejection,
} from '../types';
import {
  routeServerMessage,
  type createSyncStore,
  type SyncStoreContext,
} from './sync-store';
import type { SyncMutationQueue } from './sync-mutation-queue';
import { acceptSyncStreamMessage } from './sync-stream-guard';
import {
  messageSyncDataPlane,
  tablesInSyncDataPlane,
} from './sync-data-planes';
import type { SyncSnapshotAssembler } from './sync-snapshot-assembler';

type ExternalMessage = { type: string; [key: string]: unknown };
interface SyncSocketMessageRouterInput {
  store: ReturnType<typeof createSyncStore>['store'];
  ready: (socket: WebSocket) => boolean;
  authenticated: (socket: WebSocket, authenticated: boolean) => void;
  handlers: Set<(message: ExternalMessage) => void>;
  mutations: SyncMutationQueue;
  snapshots: SyncSnapshotAssembler;
  tablePlanes: Readonly<Record<string, SyncDataPlaneName>>;
  recover: () => void;
  mutationRejected: (rejection: SyncMutationRejection) => void;
  synchronized: (message: Extract<
    ServerMessage,
    { type: 'sync.snapshot' | 'sync.catchup' }
  >) => void;
}

/** Parses and routes authenticated WebSocket messages. */
export function routeSyncSocketEvent(
  input: SyncSocketMessageRouterInput,
  socket: WebSocket,
  event: MessageEvent,
): void {
  if (typeof event.data !== 'string') return;
  let message: ServerMessage;
  try {
    message = JSON.parse(event.data) as ServerMessage;
  } catch {
    return;
  }
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'sync.auth.ready') {
    input.authenticated(socket, message.authenticated);
    return;
  }
  if (!input.ready(socket)) return;
  if (isSnapshotFrame(message)) {
    const result = input.snapshots.accept(message);
    if (result.status === 'invalid') input.recover();
    if (result.status !== 'complete') return;
    message = result.message;
  } else if (message.type === 'sync.snapshot') {
    input.snapshots.reset();
  }
  if (isStreamMessage(message)) {
    const context = input.store.getSnapshot().context as SyncStoreContext;
    if (!acceptSyncStreamMessage(context, message, input.tablePlanes)) {
      input.recover();
      return;
    }
  }
  const rejection = mutationRejection(input.store, message);
  routeServerMessage(input.store, message);
  for (const handler of input.handlers) {
    try {
      handler(message as unknown as ExternalMessage);
    } catch {
      // Consumer callbacks cannot interrupt cursor, receipt, or queue progress.
    }
  }
  if (rejection) input.mutationRejected(rejection);
  if (message.type === 'sync.ack') input.mutations.acknowledge(message);
  if (message.type === 'sync.snapshot') {
    const plane = messageSyncDataPlane(message)!;
    const resetTables = message.reset
      ? tablesInSyncDataPlane(input.tablePlanes, plane)
      : new Set(Object.keys(message.tables));
    input.mutations.snapshot(
      resetTables,
      message.reset === 'preserve-pending',
    );
    input.synchronized(message);
  }
  if (message.type === 'sync.catchup') {
    input.synchronized(message);
  }
}

function mutationRejection(
  store: ReturnType<typeof createSyncStore>['store'],
  message: ServerMessage,
): SyncMutationRejection | null {
  if (message.type !== 'sync.ack' || message.ok) return null;
  const context = store.getSnapshot().context as SyncStoreContext;
  const mutation = context._sync.pending.find(({ ref }) => ref === message.ref);
  if (!mutation) return null;
  return {
    ref: message.ref,
    table: mutation.table,
    op: mutation.op,
    rowId: mutation.rowId,
    plane: message.plane,
    error: message.error,
    errorCode: message.errorCode,
    source: 'server',
  };
}

function isSnapshotFrame(message: ServerMessage): message is Extract<
  ServerMessage,
  {
    type:
      | 'sync.snapshot.begin'
      | 'sync.snapshot.chunk'
      | 'sync.snapshot.end';
  }
> {
  return message.type === 'sync.snapshot.begin'
    || message.type === 'sync.snapshot.chunk'
    || message.type === 'sync.snapshot.end';
}

function isStreamMessage(message: ServerMessage): message is Extract<
  ServerMessage,
  { type: 'sync.snapshot' | 'sync.change' | 'sync.catchup' }
> {
  return message.type === 'sync.snapshot'
    || message.type === 'sync.change'
    || message.type === 'sync.catchup';
}
