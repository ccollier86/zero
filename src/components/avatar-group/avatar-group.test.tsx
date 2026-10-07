import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvatarGroup, AvatarPresenceIndicator } from './index';
import { avatarGroupInitials, avatarGroupMemberLabel, resolveAvatarGroupLayout } from './avatar-group-layout';
import type { AvatarGroupMember } from './avatar-group-types';
import { AvatarGroup as LegacyAnimatedAvatarGroup } from '../animate-ui/primitives/animate/avatar-group';

const members: readonly AvatarGroupMember[] = [
  { id: 'ada', name: 'Ada Lovelace', presence: { label: 'Busy', tone: 'destructive' } },
  { id: 'grace', name: 'Grace Hopper' },
  { id: 'alan', name: 'Alan Turing' },
  { id: 'katherine', name: 'Katherine Johnson' },
];

describe('compact public avatar group', () => {
  test('uses bounded visible members and correct unloaded-member counts', () => {
    expect(resolveAvatarGroupLayout(members)).toEqual({ visible: members.slice(0, 3), remaining: 1 });
    expect(resolveAvatarGroupLayout(members, 2, 8).remaining).toBe(6);
    expect(resolveAvatarGroupLayout(members, 2, 1).remaining).toBe(2);
    expect(resolveAvatarGroupLayout(members, -1).visible).toEqual([]);
    expect(resolveAvatarGroupLayout(members, NaN, Infinity).remaining).toBe(1);
  });

  test('derives readable Unicode initials and never invents an offline label', () => {
    expect(avatarGroupInitials('Ada Lovelace')).toBe('AL');
    expect(avatarGroupInitials(' 🧑🏽‍💻 Programmer ')).toBe('🧑P');
    expect(avatarGroupInitials('')).toBe('?');
    expect(avatarGroupMemberLabel(members[0]!, false)).toBe('Ada Lovelace');
    expect(avatarGroupMemberLabel(members[0]!, true)).toBe('Ada Lovelace — Busy');
    expect(avatarGroupMemberLabel(members[1]!, true)).toBe('Grace Hopper');
  });

  test('default stack has the reference numeric count and no add action or status', () => {
    const html = renderToStaticMarkup(<AvatarGroup members={members} totalCount={8} />);
    expect(html).toContain('+5');
    expect(html).toContain('5 more members');
    expect(html).not.toContain('Add user');
    expect(html).not.toContain('avatar-presence-indicator');
    expect(html).not.toContain('Busy');
    expect(html).not.toContain('offline');
    expect(html).not.toContain('Katherine Johnson');
    expect(html.match(/tabindex="0"/g)).toHaveLength(4);
  });

  test('icon overflow and separate optional Plus button have distinct accessible labels', () => {
    const html = renderToStaticMarkup(<AvatarGroup members={members} countDisplay="icon"
      onCountClick={() => {}} addAction={{ label: 'Invite teammate', onClick: () => {} }} />);
    expect(html).toContain('aria-label="1 more member"');
    expect(html).toContain('aria-label="Invite teammate"');
    expect(html).not.toContain('+1');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).not.toMatch(/<button[^>]*>\s*<button/);
  });

  test('only enabled admitted observations decorate members; plain avatars stay plain', () => {
    expect(renderToStaticMarkup(<AvatarPresenceIndicator presence={members[0]!.presence} />)).toBe('');
    expect(renderToStaticMarkup(<AvatarPresenceIndicator enabled />)).toBe('');
    const html = renderToStaticMarkup(<AvatarGroup members={members} presenceEnabled shape="rounded" size="lg" />);
    expect(html.match(/data-slot="avatar-presence-indicator"/g)).toHaveLength(1);
    expect(html).toContain('Ada Lovelace — Busy');
    expect(html).toContain('data-tone="destructive"');
    expect(html).toContain('data-shape="rounded"');
    expect(html).toContain('--zero-avatar-group-rounded-radius');
    expect(html).toContain('--zero-avatar-group-size-lg');
    expect(html).not.toContain('Grace Hopper —');
  });

  test('pending add action is disabled and busy without changing count or members', () => {
    const html = renderToStaticMarkup(<AvatarGroup members={members} addAction={{ onClick: () => {}, pending: true }} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Add user"');
  });

  test('public refs/native attributes and CSS metric overrides survive composition', () => {
    const html = renderToStaticMarkup(<AvatarGroup members={[]} id="reviewers" aria-label="Reviewers"
      role="group" shape="square" style={{ '--zero-avatar-group-overlap': '0.25rem' } as React.CSSProperties} />);
    expect(html).toContain('id="reviewers"');
    expect(html).toContain('aria-label="Reviewers"');
    expect(html).toContain('--zero-avatar-group-square-radius');
    expect(html).toContain('--zero-avatar-group-overlap:0.25rem');
    expect(html).not.toContain('avatar-group-count');
  });

  test('legacy animated group keeps its default tooltip/tap composition', () => {
    const html = renderToStaticMarkup(<LegacyAnimatedAvatarGroup>
      {[<span key="existing">Existing child</span>]}
    </LegacyAnimatedAvatarGroup>);
    expect(html).toContain('data-slot="avatar-group"');
    expect(html).toContain('data-slot="tooltip-trigger"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('Existing child');
  });
});
