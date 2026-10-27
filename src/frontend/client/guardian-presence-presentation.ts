/** Presentation only: stale/unknown evidence never becomes an online status. */
import { createElement } from 'react';
import type { AvatarPresence } from '../../components/avatar-group/avatar-group-types';
import type { GuardianPresenceClientSnapshot } from './guardian-presence-client';
import { ZeroIcon } from '../icons';

export function guardianAvatarPresence(presence: GuardianPresenceClientSnapshot, userId: string): AvatarPresence | undefined {
  const observation = presence.observations[userId];
  const definition = presence.capabilities?.statuses.find(status => status.key === observation?.status);
  if (!observation || observation.stale || !definition || presence.status !== 'ready') return undefined;
  return { label: definition.label, tone: definition.tone,
    ...(definition.icon ? { icon: createElement(ZeroIcon, { name: definition.icon }) } : {}), variant: 'ring' };
}
