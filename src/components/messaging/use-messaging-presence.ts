'use client';

import { useCallback } from 'react';
import { useGuardianPresence } from '../../frontend/client/guardian-presence-hooks';
import { guardianAvatarPresence } from '../../frontend/client/guardian-presence-presentation';
import type { MessagingParticipant } from '../../messaging/presentation';

/** One feed subscription per consumer; never creates activity trackers or grants chat access. */
export function useMessagingPresence() {
  const presence = useGuardianPresence();
  const presenceFor = useCallback((participant: MessagingParticipant) => participant.kind === 'user'
    ? guardianAvatarPresence(presence, participant.id) : undefined, [presence.status, presence.capabilities, presence.observations]);
  return { status: presence.status, presenceFor };
}
