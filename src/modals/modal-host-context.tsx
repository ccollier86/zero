'use client';

import * as React from 'react';

/** Internal host inheritance; adapters reuse a host instead of duplicating the global scene. */
export const ModalHostContext = React.createContext(false);
export function useModalHostPresent(): boolean {
  return React.useContext(ModalHostContext);
}

const hosts = new Set<object>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
let sceneOwner: object | undefined;
/** Sibling compatibility providers also share one actual scene host. */
export function useModalHostLease(onRetire: () => void) {
  const owner = React.useRef<object>({}).current;
  const retire = React.useRef(onRetire); retire.current = onRetire;
  const first = React.useSyncExternalStore(callback => {
    listeners.add(callback); return () => { listeners.delete(callback); };
  }, () => sceneOwner, () => undefined);
  React.useLayoutEffect(() => {
    hosts.add(owner);
    if (!sceneOwner) { sceneOwner = owner; notify(); }
    return () => {
      hosts.delete(owner);
      // A Strict Mode cleanup/replay keeps the same lease. A real owning-host
      // teardown must retire its bodies before another host can render them;
      // silently remounting a live form would lose its draft/receipt ownership.
      queueMicrotask(() => {
        if (hosts.has(owner) || sceneOwner !== owner) return;
        retire.current();
        sceneOwner = hosts.values().next().value;
        notify();
      });
    };
  }, [owner]);
  return first === owner;
}

export function hasModalHosts(): boolean { return hosts.size > 0; }
