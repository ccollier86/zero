'use client';
/** Scope-owned destination reads for member and staff surfaces. No cross-controller cache or private policy data. */
import { useEffect, useState } from 'react';
import type { MessagingSupportInbox } from '../../messaging/contracts';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';

export function useSupportInboxes(controller: MessagingWorkspaceController, enabled: boolean) {
  const [generation, setGeneration] = useState(0);
  const [owner, setOwner] = useState<{ controller: MessagingWorkspaceController; generation: number; items: readonly MessagingSupportInbox[]; error: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void Promise.resolve().then(() => { abort.signal.throwIfAborted(); return controller.source.support.inboxes({ signal: abort.signal }); }).then(page => {
      if (!abort.signal.aborted && controller.current()) setOwner({ controller, generation, items: page.items, error: false });
    }).catch(() => { if (!abort.signal.aborted && controller.current()) setOwner({ controller, generation, items: [], error: true }); });
    return () => abort.abort();
  }, [controller, enabled, generation]);
  const current = enabled && owner?.controller === controller && owner.generation === generation ? owner : null;
  return { loading: enabled && !current, error: current?.error === true, items: current?.items ?? [], retry: () => setGeneration(value => value + 1) };
}
