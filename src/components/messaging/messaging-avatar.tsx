'use client';

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { AvatarPresenceIndicator } from '../avatar-group/avatar-presence-indicator';
import { avatarGroupInitials } from '../avatar-group/avatar-group-layout';
import type { AvatarPresence } from '../avatar-group/avatar-group-types';
import type { MessagingParticipant } from '../../messaging/presentation';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '../tooltip';
import './messaging.css';

/** One corner contract for the image, fallback and status perimeter, including custom avatars. */
export function MessagingAvatar({ participant, presence, presenceEnabled = false, className }: {
  participant: MessagingParticipant; presence?: AvatarPresence; presenceEnabled?: boolean; className?: string;
}) {
  const shape = participant.avatarShape;
  const style = shape ? { '--zero-messaging-avatar-radius': shape === 'circle' ? 'var(--zero-avatar-group-circle-radius, 9999px)'
    : shape === 'rounded' ? 'var(--zero-avatar-group-rounded-radius, var(--radius, 0.375rem))'
    : 'var(--zero-avatar-group-square-radius, 0px)' } as CSSProperties : undefined;
  const avatar = <span className={cn('zero-messaging-avatar', className)} data-shape={shape} style={style} aria-hidden="true">
    {participant.avatar ?? <Avatar><AvatarFallback>{avatarGroupInitials(participant.label)}</AvatarFallback></Avatar>}
    <AvatarPresenceIndicator enabled={!!presence} presence={presence} />
  </span>;
  // Keep this wrapper stable while freshness changes, so an avatar image is
  // never remounted/re-downloaded simply because its status became unknown.
  return presenceEnabled ? <AvatarStatusTooltip presence={presence}>{avatar}</AvatarStatusTooltip> : avatar;
}

function AvatarStatusTooltip({ presence, children }: { presence?: AvatarPresence; children: ReactElement }) {
  const [open, setOpen] = useState(false), enabled = !!presence;
  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);
  return <Tooltip open={enabled && open} onOpenChange={setOpen}><TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent>{presence?.label}</TooltipContent></Tooltip>;
}
