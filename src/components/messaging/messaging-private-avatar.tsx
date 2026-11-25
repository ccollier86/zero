'use client';
/** Native authenticated delivery with the same Avatar fallback as all messaging surfaces. */
import type { UserAvatarPresentation } from '../../auth/auth-user-avatar-types';
import { useUserAvatarPresentation } from '../../frontend/client/user-avatar-presentation';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { avatarGroupInitials } from '../avatar-group/avatar-group-layout';

export function MessagingPrivateAvatar({ userId, label, privateAvatar, avatarUrl }: {
  userId: string; label: string; privateAvatar?: UserAvatarPresentation | null; avatarUrl?: string | null;
}) {
  const preview = useUserAvatarPresentation(userId, privateAvatar);
  // A denied/removed private projection must never fall back to a retained
  // public/inline descriptor from the old conversation revision.
  const source = privateAvatar !== undefined ? preview : avatarUrl;
  return <Avatar>{source && <AvatarImage src={source} alt="" />}<AvatarFallback>{avatarGroupInitials(label)}</AvatarFallback></Avatar>;
}
