/** Generic IPC wiring for a trusted JavaScript host and its UI roots. */

import {
  createNativeAuthBrokerClient,
  type NativeAuthBroker,
  type NativeAuthBrokerRequest,
  type NativeAuthBrokerResponse,
  type NativeAuthBrokerSnapshot,
  type NativeAuthBrokerStateListener,
  type NativeAuthBrokerTransport,
} from '@zero/framework/native';

export interface NativeAuthBrokerHostBridge {
  handle(
    handler: (
      request: NativeAuthBrokerRequest,
      signal?: AbortSignal,
    ) => Promise<NativeAuthBrokerResponse>,
  ): () => void;
  broadcastState(snapshot: NativeAuthBrokerSnapshot): void;
}

/** Expose one main-process broker through a host-owned, access-controlled IPC channel. */
export function exposeNativeAuthBroker(
  broker: NativeAuthBroker,
  bridge: NativeAuthBrokerHostBridge,
): () => void {
  const stopRequests = bridge.handle((request, signal) => broker.request(request, { signal }));
  const stopStates = broker.subscribeState((snapshot) => bridge.broadcastState(snapshot));
  return () => { stopStates(); stopRequests(); };
}

export interface NativeAuthBrokerClientBridge {
  request(
    request: NativeAuthBrokerRequest,
    options?: { signal?: AbortSignal },
  ): Promise<NativeAuthBrokerResponse>;
  subscribeState(listener: NativeAuthBrokerStateListener): () => void;
}

/** Create a renderer/UI-root client that never opens the credential vault itself. */
export function createBrokeredNativeAuth(input: {
  serverUrl: string;
  bridge: NativeAuthBrokerClientBridge;
}) {
  const transport: NativeAuthBrokerTransport = input.bridge;
  return createNativeAuthBrokerClient({ serverUrl: input.serverUrl, transport });
}
