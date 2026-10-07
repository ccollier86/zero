/** Isolated presentation-only fixture with no account, backend or subscriptions. */
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { AvatarGroup } from './avatar-group';
import type { AvatarGroupMember, AvatarGroupShape } from './avatar-group-types';

const roster: readonly AvatarGroupMember[] = [
  { id: 'ada', name: 'Ada Lovelace', presence: { label: 'Busy', tone: 'destructive' } },
  { id: 'grace', name: 'Grace Hopper', presence: { label: 'Available', tone: 'success' } },
  { id: 'alan', name: 'Alan Turing' },
];
declare global {
  interface Window {
    __avatarGroupFixture: {
      enablePresence(value: boolean): void;
      shape(value: AvatarGroupShape): void;
      reorder(): void;
      pending(value: boolean): void;
    };
  }
}

function Fixture() {
  const [presenceEnabled, enablePresence] = useState(false);
  const [shape, setShape] = useState<AvatarGroupShape>('circle');
  const [members, setMembers] = useState(roster);
  const [pending, setPending] = useState(false);
  const [adds, setAdds] = useState(0);
  const [counts, setCounts] = useState(0);
  window.__avatarGroupFixture = {
    enablePresence, shape: setShape, pending: setPending,
    reorder: () => setMembers((current) => [...current].reverse()),
  };
  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="text-lg font-semibold tracking-tight">Project collaborators</h1>
      <p className="mt-1 text-sm text-muted-foreground">Compact avatars with optional actions and admitted visual status.</p>
      <section className="mt-8 flex flex-col gap-8">
        <div><p className="mb-3 text-xs font-medium text-muted-foreground">Default</p>
          <AvatarGroup data-testid="primary" members={members} totalCount={8} shape={shape}
            role="group" aria-label="Team members" presenceEnabled={presenceEnabled}
            onCountClick={() => setCounts((value) => value + 1)}
            addAction={{ label: 'Invite teammate', pending, onClick: () => setAdds((value) => value + 1) }} />
        </div>
        <div><p className="mb-3 text-xs font-medium text-muted-foreground">Icon count · rounded-square</p>
          <AvatarGroup data-testid="rounded" members={roster} totalCount={8} countDisplay="icon"
            shape="rounded" size="lg" presenceEnabled addAction={{ onClick: () => {} }} />
        </div>
        <div><p className="mb-3 text-xs font-medium text-muted-foreground">Square</p>
          <AvatarGroup data-testid="square" members={roster} shape="square" presenceEnabled />
        </div>
        <div><p className="mb-3 text-xs font-medium text-muted-foreground">Custom metrics · no animation</p>
          <AvatarGroup data-testid="tokens" members={roster} totalCount={8} countDisplay="icon" animated={false}
            style={{ '--zero-avatar-group-size-default': '36px', '--zero-avatar-group-overlap': '12px',
              '--zero-avatar-group-outline-width': '3px', '--zero-avatar-group-icon-size': '18px',
              '--zero-avatar-group-initials-font-size': '13px' } as CSSProperties} />
        </div>
      </section>
      <p className="mt-8 text-sm text-muted-foreground" data-testid="actions">Invites {adds} · Counts {counts}</p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
