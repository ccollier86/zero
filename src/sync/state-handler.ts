import type { ServerWebSocket } from 'bun';
import type { StateManager } from './state-manager';
import type {
  SyncSocketData,
  StateSetMessage,
  StateDeleteMessage,
  StateClearMessage,
  StateSnapshotMessage,
  StateAckMessage,
} from './types';
import {
  serviceDataScopeFromIdentity,
  serviceDataScopeKey,
} from '../auth/service-data-scope';
import { sendSyncWire } from './sync-wire-send';

interface StateMutationOriginContext {
  current: string | null;
}

/**
 * Handle state.subscribe — load user state and send snapshot.
 * Requires authenticated connection (userId from authContext).
 */
export function handleStateSubscribe(
  ws: ServerWebSocket<SyncSocketData>,
  stateManager: StateManager,
  _server: { publish: (topic: string, data: string) => void },
  tenancyMode: 'single' | 'multi' = 'single',
  validateCurrentAuthority: () => boolean = allowCurrentAuthority,
): void {
  const principal = resolveStatePrincipal(ws.data.authContext, tenancyMode);
  if (!principal) return; // Unauthenticated or invalid scope — ignore

  // Bind the authoritative rows and the durable state cursor to one SQLite
  // snapshot. A pending replica event already represented here is ignored when
  // the ordered dispatcher later reaches it.
  const state = stateManager.getUserStateSnapshot(principal, validateCurrentAuthority);
  if (!state) return;
  ws.data.stateSubscribed = true;
  ws.data.statePrincipal = principal;
  ws.data.stateLastSeq = state.seq;
  const snapshot: StateSnapshotMessage = {
    type: 'state.snapshot',
    entries: state.entries,
  };
  if (!sendSyncWire(ws, snapshot)) {
    ws.data.stateSubscribed = false;
    ws.data.statePrincipal = null;
    ws.data.stateLastSeq = 0;
  }
}

/**
 * Handle state.set — persist and acknowledge the sender.
 * Ordered onChange delivery notifies every other authorized device.
 */
export function handleStateSet(
  ws: ServerWebSocket<SyncSocketData>,
  msg: StateSetMessage,
  stateManager: StateManager,
  _server: { publish: (topic: string, data: string) => void },
  tenancyMode: 'single' | 'multi' = 'single',
  mutationOrigin?: StateMutationOriginContext,
  validateCurrentAuthority: () => boolean = allowCurrentAuthority,
): void {
  const principal = resolveStatePrincipal(ws.data.authContext, tenancyMode);
  if (!principal) {
    sendStateAck(ws, msg.ref, false, 'UNAUTHORIZED');
    return;
  }

  const result = withStateMutationOrigin(ws, mutationOrigin, () =>
    stateManager.set(principal, msg.key, msg.value, validateCurrentAuthority));

  if (!result.ok) {
    sendStateAck(ws, msg.ref, false, result.error);
    return;
  }

  // Ack the sender
  sendStateAck(ws, msg.ref, true);
}

/**
 * Handle state.delete — remove and acknowledge the sender.
 * Ordered onChange delivery notifies every other authorized device.
 */
export function handleStateDelete(
  ws: ServerWebSocket<SyncSocketData>,
  msg: StateDeleteMessage,
  stateManager: StateManager,
  _server: { publish: (topic: string, data: string) => void },
  tenancyMode: 'single' | 'multi' = 'single',
  mutationOrigin?: StateMutationOriginContext,
  validateCurrentAuthority: () => boolean = allowCurrentAuthority,
): void {
  const principal = resolveStatePrincipal(ws.data.authContext, tenancyMode);
  if (!principal) {
    sendStateAck(ws, msg.ref, false, 'UNAUTHORIZED');
    return;
  }

  const result = withStateMutationOrigin(ws, mutationOrigin, () =>
    stateManager.delete(principal, msg.key, validateCurrentAuthority));
  if (!result.ok) {
    sendStateAck(ws, msg.ref, false, result.error);
    return;
  }

  sendStateAck(ws, msg.ref, true);
}

/**
 * Handle state.clear — wipe all user state and acknowledge the sender.
 * Ordered onChange delivery notifies every other authorized device.
 */
export function handleStateClear(
  ws: ServerWebSocket<SyncSocketData>,
  msg: StateClearMessage,
  stateManager: StateManager,
  _server: { publish: (topic: string, data: string) => void },
  tenancyMode: 'single' | 'multi' = 'single',
  mutationOrigin?: StateMutationOriginContext,
  validateCurrentAuthority: () => boolean = allowCurrentAuthority,
): void {
  const principal = resolveStatePrincipal(ws.data.authContext, tenancyMode);
  if (!principal) {
    sendStateAck(ws, msg.ref, false, 'UNAUTHORIZED');
    return;
  }

  const result = withStateMutationOrigin(ws, mutationOrigin, () =>
    stateManager.clear(principal, validateCurrentAuthority));
  if (!result.ok) {
    sendStateAck(ws, msg.ref, false, result.error);
    return;
  }

  sendStateAck(ws, msg.ref, true);
}

// ─── Internal ─────────────────────────────────────────────────────────────

function sendStateAck(
  ws: ServerWebSocket<SyncSocketData>,
  ref: string,
  ok: boolean,
  error?: string
): void {
  const ack: StateAckMessage = { type: 'state.ack', ref, ok };
  if (error) ack.error = error as StateAckMessage['error'];
  sendSyncWire(ws, ack);
}

/** Stable protocol rejection for malformed State Sync messages. */
export function sendInvalidStateRequest(
  ws: ServerWebSocket<SyncSocketData>,
  ref: string,
): void {
  sendStateAck(ws, ref, false, 'INVALID_REQUEST');
}

function withStateMutationOrigin<T>(
  ws: ServerWebSocket<SyncSocketData>,
  mutationOrigin: StateMutationOriginContext | undefined,
  mutate: () => T,
): T {
  if (!mutationOrigin) return mutate();
  const previous = mutationOrigin.current;
  mutationOrigin.current = ws.data.connectionId;
  try {
    return mutate();
  } finally {
    mutationOrigin.current = previous;
  }
}

function allowCurrentAuthority(): boolean {
  return true;
}

/**
 * Single-mode state keeps its historical per-user key. Tenant sessions add a
 * server-owned scope prefix, so the same identity can reuse a state key in two
 * organizations without reading or overwriting the other tenant's value.
 */
export function resolveStatePrincipal(
  auth: SyncSocketData['authContext'],
  tenancyMode: 'single' | 'multi',
): string | null {
  if (!auth?.userId) return null;
  const scope = serviceDataScopeFromIdentity(auth, tenancyMode);
  if (!scope) return null;
  return scope.scopeKind === 'tenant'
    ? `${serviceDataScopeKey(scope)}:user:${auth.userId}`
    : auth.userId;
}
