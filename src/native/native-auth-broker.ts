/** Single-owner native auth broker used directly or behind a trusted IPC bridge. */

import type { NativeAuthClient, NativeAuthState, NativeAuthStateListener } from './client-types';
import { dispatchNativeAuthBrokerCommand } from './broker-dispatch';
import { cloneNativeAuthState } from './broker-state';
import { createNativeAuthBrokerStateChannel } from './broker-state-channel';
import type { NativeAuthBrokerTransport } from './broker-types';

export interface NativeAuthBroker extends NativeAuthClient, NativeAuthBrokerTransport {}

/** Wrap one credential-owning client and single-flight broker-wide refresh/init calls. */
export function createNativeAuthBroker(client: NativeAuthClient): NativeAuthBroker {
  let initialize: Promise<NativeAuthState> | null = null;
  let refresh: Promise<NativeAuthState> | null = null;
  let signingOut: Promise<void> | null = null;
  const channel = createNativeAuthBrokerStateChannel(client);
  const single = <T>(current: Promise<T> | null, run: () => Promise<T>, set: (next: Promise<T> | null) => void) => {
    if (current) return current;
    const pending = run().finally(() => set(null));
    set(pending);
    return pending;
  };
  const afterSignOut = <T>(run: () => Promise<T>) => signingOut
    ? signingOut.catch(() => undefined).then(run)
    : run();
  const broker: NativeAuthBroker = {
    get state() { return client.state; },
    initialize: () => afterSignOut(() => single(
      initialize, () => client.initialize(), (next) => { initialize = next; },
    )),
    signIn: (options) => afterSignOut(() => client.signIn(options)),
    signUp: (options) => afterSignOut(() => client.signUp(options)),
    completeAuthorization: (url, signal) => afterSignOut(
      () => client.completeAuthorization(url, signal),
    ),
    refresh: () => afterSignOut(() => single(
      refresh, () => client.refresh(), (next) => { refresh = next; },
    )),
    getUser: () => client.getUser(),
    getAccessToken: () => afterSignOut(() => client.getAccessToken()),
    fetch: (input, init) => afterSignOut(() => client.fetch(input, init)),
    signOut: () => {
      if (signingOut) return signingOut;
      const pending = Promise.resolve().then(() => client.signOut()).finally(() => {
        if (signingOut === pending) signingOut = null;
      });
      signingOut = pending;
      return pending;
    },
    subscribe(listener: NativeAuthStateListener) {
      const unsubscribe = client.subscribe((state) => safelyPublish(listener, state));
      safelyPublish(listener, client.state);
      return unsubscribe;
    },
    request: (command, options) => dispatchNativeAuthBrokerCommand(
      broker, channel, command, options?.signal,
    ),
    subscribeState: (listener) => channel.subscribe(listener),
  };
  return broker;
}

function safelyPublish(listener: NativeAuthStateListener, state: NativeAuthState): void {
  try { listener(cloneNativeAuthState(state)); } catch {}
}
