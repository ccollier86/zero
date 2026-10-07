/** Pure roster bounds, fallback and labels for the avatar-group presentation. */

import type { AvatarGroupMember } from './avatar-group-types';

/** Bounded rendering and an honest remaining count, including unloaded users. */
export function resolveAvatarGroupLayout(
  members: readonly AvatarGroupMember[], maxVisible = 3, totalCount = members.length,
): { visible: readonly AvatarGroupMember[]; remaining: number } {
  const limit = Number.isFinite(maxVisible) ? Math.max(0, Math.floor(maxVisible)) : 3;
  const total = Number.isFinite(totalCount)
    ? Math.max(members.length, Math.floor(totalCount)) : members.length;
  const visible = members.slice(0, limit);
  return { visible, remaining: Math.max(0, total - visible.length) };
}

/** Unicode-aware initials when the app has not supplied a fallback. */
export function avatarGroupInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return [words[0], ...(words.length > 1 ? [words[words.length - 1]] : [])]
    .map((word) => Array.from(word!.normalize('NFC'))[0] ?? '').join('').toUpperCase();
}

/** Disabled or missing presence never invents an offline observation. */
export function avatarGroupMemberLabel(member: AvatarGroupMember, enabled: boolean): string {
  const name = member.name.trim() || 'Member';
  return enabled && member.presence?.label ? `${name} — ${member.presence.label}` : name;
}
