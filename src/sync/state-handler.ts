import type { ServerWebSocket } from 'bun';
import type { StateManager } from './state-manager';
import type {
  SyncSocketData,
  StateSetMessage,
  StateDeleteMessage,
  StateClearMessage,
  StateSnapshotMessage,
  StateAckMessage,
  StateChangeMessage,
} from './types';

/**
 * Handle state.subscribe — load user state and send snapshot.
 * Requires authenticated connection (userId from authContext).
 */
export function handleStateSubscribe(
  ws: ServerWebSocket<SyncSocketData>,
  stateManager: StateManager,
  server: { publish: (topic: string, data: string) => void }
): void {
  const userId = ws.data.authContext?.userId;
  if (!userId) return; // Unauthenticated — ignore

  // Subscribe to Bun pub/sub topic for this user's state changes
  const topic = `state:${userId}`;
  if (!ws.data.subscribedTopics.has(topic)) {
    ws.subscribe(topic);
    ws.data.subscribedTopics.add(topic);
  }
  ws.data.stateSubscribed = true;

  // Send current state as snapshot
  const entries = stateManager.getUserStateEntries(userId);
  const snapshot: StateSnapshotMessage = {
    type: 'state.snapshot',
    entries,
  };
  ws.send(JSON.stringify(snapshot));
}

/**
 * Handle state.set — persist, ack, and publish to other devices.
 */
export function handleStateSet(
  ws: ServerWebSocket<SyncSocketData>,
  msg: StateSetMessage,
  stateManager: StateManager,
  server: { publish: (topic: string, data: string) => void }
): void {
  const userId = ws.data.authContext?.userId;
  if (!userId) {
    sendStateAck(ws, msg.ref, false, 'UNAUTHORIZED');
    return;
  }

  const result = stateManager.set(userId, msg.key, msg.value);

  if (!result.ok) {
    sendStateAck(ws, msg.ref, false, result.error);
    return;
  }

  // Ack the sender
  sendStateAck(ws, msg.ref, true);

  // Publish to all other devices for this user
  const change: StateChangeMessage = {
    type: 'state.change',
    key: msg.key,
    value: msg.value,
    op: 'set',
  };
  server.publish(`state:${userId}`, JSON.stringify(change));
}

/**
 * Handle state.delete — remove, ack, and publish.
 */
export function handleStateDelete(
  ws: ServerWebSocket<SyncSocketData>,
  msg: StateDeleteMessage,
  stateManager: StateManager,
  server: { publish: (topic: string, data: string) => void }
): void {
  const userId = ws.data.authContext?.userId;
  if (!userId) {
    sendStateAck(ws, msg.ref, false, 'UNAUTHORIZED');
    return;
  }

  stateManager.delete(userId, msg.key);

  sendStateAck(ws, msg.ref, true);

  const change: StateChangeMessage = {
    type: 'state.change',
    key: msg.key,
    value: undefined,
    op: 'delete',
  };
  server.publish(`state:${userId}`, JSON.stringify(change));
}

/**
 * Handle state.clear — wipe all user state, ack, and publish.
 */
export function handleStateClear(
  ws: ServerWebSocket<SyncSocketData>,
  msg: StateClearMessage,
  stateManager: StateManager,
  server: { publish: (topic: string, data: string) => void }
): void {
  const userId = ws.data.authContext?.userId;
  if (!userId) {
    sendStateAck(ws, msg.ref, false, 'UNAUTHORIZED');
    return;
  }

  stateManager.clear(userId);

  sendStateAck(ws, msg.ref, true);

  const change: StateChangeMessage = {
    type: 'state.change',
    key: null,
    value: undefined,
    op: 'clear',
  };
  server.publish(`state:${userId}`, JSON.stringify(change));
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
  ws.send(JSON.stringify(ack));
}
