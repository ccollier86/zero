/** Payload-free local projection hints; empty/read transactions never wake their own projection. */
import type { ReactiveDB } from '../sync/reactive-db';
import { readAuthAuthorityRevision } from '../auth/auth-authority-revision';

export function observeMessagingPresentationCommits(db: Pick<ReactiveDB, 'prepare' | 'onCommit'>, changed: () => void): () => void {
  const changes = db.prepare('SELECT total_changes() AS total');
  let previous = (changes.get() as { total: number }).total;
  const remove = db.onCommit(() => {
    const current = (changes.get() as { total: number }).total;
    if (current === previous) return;
    // Advance before notifying: synchronous projection preparation may finish
    // an empty root transaction and must not recursively wake itself.
    previous = current; changed();
  });
  let active = true;
  return () => { if (!active) return; active = false; remove(); changes.finalize(); };
}

/** SYSTEM has a cheap durable authority clock and tracked profile CAS; unrelated writes are not chat hints. */
export function observeMessagingSystemPresentation(db: Pick<ReactiveDB, 'prepare' | 'onCommit' | 'onChange'>,
  changed: { authority(): void; presentation(): void }): () => void {
  let authority = readAuthAuthorityRevision(db), active = true;
  const removeProfile = db.onChange(change => {
    if (!active || change.table !== 'users' || change.op !== 'UPDATE' || !change.row) return;
    if (change.row.profile_revision === change.previousRow?.profile_revision) return;
    // Avatar accept/remove and normal profile writers advance the shared CAS
    // through db.update inside their atomic transaction. These canonical rows
    // reach this server-only listener after commit, never the browser stream.
    changed.presentation();
  });
  const removeAuthority = db.onCommit(() => {
    if (!active) return;
    const current = readAuthAuthorityRevision(db);
    if (current === authority) return;
    authority = current;
    changed.authority();
  });
  return () => { if (!active) return; active = false; removeProfile(); removeAuthority(); };
}
