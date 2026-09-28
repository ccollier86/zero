import type { ServerMessage } from '../types';
import {
  routeServerMessage,
  type createSyncStore,
  type SyncStoreContext,
} from './sync-store';
import type { SyncMutationQueue } from './sync-mutation-queue';
import { acceptSyncStreamMessage } from './sync-stream-guard';

type ExternalMessage = { type: string; [key: string]: unknown };
interface SyncSocketMessageRouterInput {
  store: ReturnType<typeof createSyncStore>['store'];
  ready: (socket: WebSocket) => boolean;
  authenticated: (socket: WebSocket, authenticated: boolean) => void;
  handlers: Set<(message: ExternalMessage) => void>;
  mutations: SyncMutationQueue;
  recover: () => void;
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
  if (isStreamMessage(message)) {
    const context = input.store.getSnapshot().context as SyncStoreContext;
    if (!acceptSyncStreamMessage(context, message)) {
      input.recover();
      return;
    }
  }
  routeServerMessage(input.store, message);
  for (const handler of input.handlers) {
    handler(message as unknown as ExternalMessage);
  }
  if (message.type === 'sync.ack') input.mutations.acknowledge(message.ref);
  if (message.type === 'sync.snapshot') {
    if (message.reset === 'purge') input.mutations.clear();
    else input.mutations.snapshot(
      new Set(Object.keys(message.tables)),
      message.reset === 'preserve-pending',
    );
    input.synchronized(message);
  }
  if (message.type === 'sync.catchup') {
    input.synchronized(message);
  }
}

function isStreamMessage(message: ServerMessage): message is Extract<
  ServerMessage,
  { type: 'sync.snapshot' | 'sync.change' | 'sync.catchup' }
> {
  return message.type === 'sync.snapshot'
    || message.type === 'sync.change'
    || message.type === 'sync.catchup';
}
