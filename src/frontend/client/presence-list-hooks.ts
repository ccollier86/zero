/**
 * presence-list-hooks.ts
 *
 * Composes room presence into a UI-ready member list. This file owns presence
 * filtering and display metadata only; ephemeral transport remains in
 * `usePresence` and the sync client.
 */

import { useMemo, useState } from 'react';
import { useAuth } from './auth-hooks';
import { usePresence, type PresenceMember } from './room-hooks';
import { useInterval } from '../../hooks/use-interval';

export interface PresenceListMember extends PresenceMember {
  label: string;
  isCurrentUser: boolean;
}

export interface UsePresenceListOptions {
  includeSelf?: boolean;
  staleMs?: number;
  data?: Record<string, unknown>;
  labelForMember?: (member: PresenceMember) => string;
}

export interface UsePresenceListReturn {
  members: PresenceListMember[];
  onlineCount: number;
  update: (data: Record<string, unknown>) => void;
}

const DEFAULT_STALE_MS = 30_000;

function defaultPresenceLabel(member: PresenceMember): string {
  const custom = member.custom ?? {};
  return String(custom.name ?? custom.label ?? custom.username ?? member.userId);
}

/**
 * Return a display-ready presence list for one room.
 *
 * The hook keeps stale-user filtering local to the UI layer while preserving
 * `usePresence` as the lower-level ephemeral sync primitive.
 */
export function usePresenceList(
  roomId: string,
  options: UsePresenceListOptions = {},
): UsePresenceListReturn {
  const { user } = useAuth();
  const presence = usePresence(roomId, options.data);
  const includeSelf = options.includeSelf ?? false;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const [now, setNow] = useState(() => Date.now());

  useInterval(() => setNow(Date.now()), 5_000);

  const members = useMemo(() => {
    const cutoff = now - staleMs;
    return presence.members
      .filter((member) => member.lastSeen >= cutoff)
      .filter((member) => includeSelf || member.userId !== user?.userId)
      .map((member) => ({
        ...member,
        label: options.labelForMember?.(member) ?? defaultPresenceLabel(member),
        isCurrentUser: member.userId === user?.userId,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [includeSelf, now, options, presence.members, staleMs, user?.userId]);

  return {
    members,
    onlineCount: members.length,
    update: presence.update,
  };
}
