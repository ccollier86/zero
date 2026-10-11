/** Synthetic select theme/ownership fixture; no application configuration, accounts, data services or fonts are loaded. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './select';
import { OverlayScopeProvider, hasOwnedFloatingOverlay } from '../../overlays/overlay-scope';

const refs = {
  outside: { trigger: null as HTMLButtonElement | null, content: null as HTMLDivElement | null, triggerMounts: 0, contentMounts: 0 },
  owned: { trigger: null as HTMLButtonElement | null, content: null as HTMLDivElement | null, triggerMounts: 0, contentMounts: 0 },
};
const changes: Array<{ kind: string; value: string }> = [];
const triggerRefs = Object.fromEntries((['outside', 'owned'] as const).map(kind => [kind, (element: HTMLButtonElement | null) => {
  refs[kind].trigger = element;
  if (element) refs[kind].triggerMounts++;
}])) as Record<'outside' | 'owned', React.RefCallback<HTMLButtonElement>>;
const contentRefs = Object.fromEntries((['outside', 'owned'] as const).map(kind => [kind, (element: HTMLDivElement | null) => {
  refs[kind].content = element;
  if (element) refs[kind].contentMounts++;
}])) as Record<'outside' | 'owned', React.RefCallback<HTMLDivElement>>;
let setActive!: (active: boolean) => void;
let setContentOverrides!: (value: React.CSSProperties) => void;

function SelectExample({ kind }: { kind: 'outside' | 'owned' }) {
  const [value, setValue] = React.useState('one');
  const [style, updateStyle] = React.useState<React.CSSProperties>();
  if (kind === 'owned') setContentOverrides = updateStyle;
  return <form data-testid={`${kind}-form`}>
    <Select name="choice" value={value} onValueChange={next => { changes.push({ kind, value: next }); setValue(next); }}>
      <SelectTrigger ref={triggerRefs[kind]} aria-label={`${kind} choice`} data-testid={`${kind}-trigger`}><SelectValue /></SelectTrigger>
      <SelectContent ref={contentRefs[kind]} data-testid={`${kind}-content`} style={style}>
        <SelectItem value="one">One</SelectItem><SelectItem value="two">Two</SelectItem><SelectItem value="three">Three</SelectItem>
      </SelectContent>
    </Select>
  </form>;
}

function Fixture() {
  const [active, updateActive] = React.useState(true);
  setActive = updateActive;
  const owner = React.useMemo(() => ({ id: 'select-theme-owner', active, zIndex: 1400,
    themeStyle: { '--zero-theme-font-body': 'serif', '--zero-type-navigation-size': '11px', '--popover': '#ffffff' } as React.CSSProperties }), [active]);
  return <main>
    <section id="outside-source" data-zero-theme="next" data-zero-mode="light"
      style={{ '--zero-theme-font-body': 'monospace', '--zero-type-navigation-size': '19px', '--popover': '#112233' } as React.CSSProperties}>
      <SelectExample kind="outside" />
    </section>
    <section id="owned-owner" style={owner.themeStyle}>
      <OverlayScopeProvider value={owner}>
        <section id="owned-source" data-zero-theme="next" data-zero-mode="light"
          style={{ '--zero-theme-font-body': 'monospace', '--zero-type-navigation-size': '23px', '--popover': '#556677' } as React.CSSProperties}>
          <SelectExample kind="owned" />
        </section>
      </OverlayScopeProvider>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
Object.assign(window, { __selectTheme: {
  refs: (kind: 'outside' | 'owned') => ({ triggerMounts: refs[kind].triggerMounts, contentMounts: refs[kind].contentMounts,
    triggerMatches: refs[kind].trigger === document.querySelector(`[data-testid="${kind}-trigger"]`),
    contentMatches: refs[kind].content === document.querySelector(`[data-testid="${kind}-content"]`) }),
  changes: () => structuredClone(changes), setActive: (active: boolean) => setActive(active),
  setContentOverrides: (value: React.CSSProperties) => setContentOverrides(value),
  registered: () => hasOwnedFloatingOverlay('select-theme-owner'),
} });
