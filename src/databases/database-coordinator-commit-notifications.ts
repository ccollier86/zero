/** Framework-private, advisory commit hints; durable recovery never relies on them. */
import type { DatabaseRef } from './database-file';

type Listener = (sourceRef: DatabaseRef) => void;
const listeners = new WeakMap<object, Set<Listener>>();
const startup = new WeakMap<object, Set<() => void>>();

export function observeDatabaseCoordinatorStarted(owner: object, listener: () => void): () => void {
  let entries = startup.get(owner); if (!entries) startup.set(owner, entries = new Set());
  entries.add(listener); return () => { entries!.delete(listener); };
}
export function notifyDatabaseCoordinatorStarted(owner: object): void {
  for (const listener of startup.get(owner) ?? []) try { listener(); } catch { /* Startup hints do not change database ownership. */ }
}

export function observeDatabaseCoordinatorCommits(owner: object, listener: Listener): () => void {
  let current = listeners.get(owner);
  if (!current) listeners.set(owner, current = new Set());
  current.add(listener);
  return () => {
    current.delete(listener);
    if (current.size === 0 && listeners.get(owner) === current) listeners.delete(owner);
  };
}

export function notifyDatabaseCoordinatorCommit(owner: object, sourceRef: DatabaseRef): void {
  for (const listener of [...(listeners.get(owner) ?? [])]) {
    try { listener(sourceRef); }
    catch { /* A scheduler hint cannot change a committed write's outcome. */ }
  }
}
