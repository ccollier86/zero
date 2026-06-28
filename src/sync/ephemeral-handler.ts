import type { ServerWebSocket } from 'bun';
import type { EphemeralStateManager } from './ephemeral-manager';
import type {
  SyncSocketData,
  EphemeralSubscribeMessage,
  EphemeralUnsubscribeMessage,
  EphemeralSetMessage,
  EphemeralDeleteMessage,
  EphemeralSnapshotMessage,
  EphemeralChangeMessage,
  JsonValue,
} from './types';

/**
 * Handle ephemeral.subscribe — subscribe to a topic and send current snapshot.
 */
export function handleEphemeralSubscribe(
  ws: ServerWebSocket<SyncSocketData>,
  msg: EphemeralSubscribeMessage,
  manager: EphemeralStateManager,
  broadcastTo: (topic: string, data: string, exclude?: string) => void
): void {
  const { topic } = msg;
  if (!topic || typeof topic !== 'string') return;

  const connectionId = ws.data.connectionId;

  // Track subscription
  manager.subscribe(topic, connectionId);
  ws.data.ephemeralTopics.add(topic);

  // Subscribe to Bun pub/sub for this ephemeral topic
  const pubsubTopic = `ephemeral:${topic}`;
  if (!ws.data.subscribedTopics.has(pubsubTopic)) {
    ws.subscribe(pubsubTopic);
    ws.data.subscribedTopics.add(pubsubTopic);
  }

  // Send current snapshot
  const entries = manager.getSnapshot(topic);
  const snapshot: EphemeralSnapshotMessage = {
    type: 'ephemeral.snapshot',
    topic,
    entries,
  };
  ws.send(JSON.stringify(snapshot));
}

/**
 * Handle ephemeral.unsubscribe — unsubscribe from a topic.
 */
export function handleEphemeralUnsubscribe(
  ws: ServerWebSocket<SyncSocketData>,
  msg: EphemeralUnsubscribeMessage,
  manager: EphemeralStateManager
): void {
  const { topic } = msg;
  if (!topic || typeof topic !== 'string') return;

  manager.unsubscribe(topic, ws.data.connectionId);
  ws.data.ephemeralTopics.delete(topic);

  const pubsubTopic = `ephemeral:${topic}`;
  ws.unsubscribe(pubsubTopic);
  ws.data.subscribedTopics.delete(pubsubTopic);
}

/**
 * Handle ephemeral.set — store value and broadcast change.
 */
export function handleEphemeralSet(
  ws: ServerWebSocket<SyncSocketData>,
  msg: EphemeralSetMessage,
  manager: EphemeralStateManager,
  server: { publish: (topic: string, data: string) => void }
): void {
  const { topic, key, value, ttl } = msg;
  if (!topic || typeof topic !== 'string') return;
  if (!key || typeof key !== 'string') return;
  if (value === undefined) return;

  const userId = ws.data.authContext?.userId ?? ws.data.connectionId;
  manager.set(topic, key, value, userId, ttl);

  // Broadcast change to all subscribers via Bun pub/sub
  const change: EphemeralChangeMessage = {
    type: 'ephemeral.change',
    topic,
    key,
    value,
    userId,
    op: 'set',
  };
  server.publish(`ephemeral:${topic}`, JSON.stringify(change));
}

/**
 * Handle ephemeral.delete — remove key and broadcast change.
 */
export function handleEphemeralDelete(
  ws: ServerWebSocket<SyncSocketData>,
  msg: EphemeralDeleteMessage,
  manager: EphemeralStateManager,
  server: { publish: (topic: string, data: string) => void }
): void {
  const { topic, key } = msg;
  if (!topic || typeof topic !== 'string') return;
  if (!key || typeof key !== 'string') return;

  const deleted = manager.delete(topic, key);
  if (!deleted) return;

  const userId = ws.data.authContext?.userId ?? ws.data.connectionId;
  const change: EphemeralChangeMessage = {
    type: 'ephemeral.change',
    topic,
    key,
    value: null,
    userId,
    op: 'delete',
  };
  server.publish(`ephemeral:${topic}`, JSON.stringify(change));
}

/**
 * Clean up all ephemeral state for a disconnected socket.
 * Called from sync.plugin.ts on ws close.
 */
export function cleanupEphemeralForSocket(
  ws: ServerWebSocket<SyncSocketData>,
  manager: EphemeralStateManager
): void {
  manager.unsubscribeAll(ws.data.connectionId);
  ws.data.ephemeralTopics.clear();
}
