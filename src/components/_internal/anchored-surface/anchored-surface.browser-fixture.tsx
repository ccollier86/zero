/** Synthetic anchored positioning, source-theme and owned-menu contracts; no application or service boot. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '../../surfaces/popover/popover';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '../../animate-ui/components/radix/dropdown-menu';
import { ModalManager } from '../../../modals/modal-manager';
import { modals } from '../../../modals/modal-events';
import type { ModalContext } from '../../../modals/modal-system.types';
import { OverlayScopeProvider, hasOwnedFloatingOverlay } from '../overlay-scope/overlay-scope';

type Configuration = { side: 'top' | 'right' | 'bottom' | 'left'; x: number; y: number; custom: boolean };
const changes: boolean[] = [];
const refs = { trigger: null as HTMLButtonElement | null, content: null as HTMLDivElement | null,
  triggerMounts: 0, contentMounts: 0 };
let configure!: (config: Partial<Configuration>) => void, setOpen!: (open: boolean) => void;
let setOwnerActive!: (active: boolean) => void, setOverrides!: (style: React.CSSProperties) => void;

function OwnedMenu({ context, kind }: { context: ModalContext; kind: 'parent' | 'child' }) {
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button">Open {kind} menu</button></DropdownMenuTrigger>
      <DropdownMenuContent data-testid={`${kind}-menu`}>
        <DropdownMenuItem>Inspect record</DropdownMenuItem>
        <DropdownMenuSub><DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-testid={`${kind}-submenu`}><DropdownMenuItem>Copy record</DropdownMenuItem></DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
    {kind === 'parent' && <button type="button" onClick={event => context.show({ title: 'Child anchored owner', trigger: event.currentTarget,
      body: child => <OwnedMenu context={child} kind="child" /> })}>Open child owner</button>}
  </>;
}

function Fixture() {
  const [config, setConfig] = React.useState<Configuration>({ side: 'bottom', x: 400, y: 350, custom: false });
  const [open, changeOpen] = React.useState(false), [ownedOpen, changeOwnedOpen] = React.useState(false);
  const [active, changeActive] = React.useState(true), [overrides, changeOverrides] = React.useState<React.CSSProperties>({});
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = React.useState('unchanged');
  configure = next => setConfig(previous => ({ ...previous, ...next })); setOpen = changeOpen;
  setOwnerActive = changeActive; setOverrides = changeOverrides;
  const triggerRef = React.useCallback((element: HTMLButtonElement | null) => {
    refs.trigger = element; if (element) refs.triggerMounts += 1;
  }, []);
  const contentRef = React.useCallback((element: HTMLDivElement | null) => {
    refs.content = element; if (element) refs.contentMounts += 1;
  }, []);
  return <ModalManager portalContainer={document.getElementById('modal-portals')}>
    <main data-zero-theme-foundation="next" style={{ minHeight: 900 }}>
      <form data-testid="anchor-form" onSubmit={event => event.preventDefault()}>
        <div id="anchor-source" style={{ '--zero-theme-font-body': 'monospace', '--popover': '#112233' } as React.CSSProperties}>
          <Popover open={open} onOpenChange={next => { changes.push(next); changeOpen(next); }}>
            <PopoverTrigger asChild><button ref={triggerRef} type="button" data-testid="anchor-trigger"
              style={{ position: 'fixed', left: config.x, top: config.y, width: 100, height: 32 }}>Open surface</button></PopoverTrigger>
            <PopoverContent ref={contentRef} data-testid="anchor-content" side={config.side} align="start" collisionPadding={8}
              className="w-52" style={overrides}
              {...(config.custom ? { initial: { opacity: 0, scale: .9 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: .9 }, transition: { duration: .25 } } : {})}>
              <label>Draft<input name="draft" aria-label="Anchored draft" value={draft} onChange={event => setDraft(event.target.value)} /></label>
              <PopoverClose asChild><button type="button">Close surface</button></PopoverClose>
            </PopoverContent>
          </Popover>
        </div>
      </form>
      <div id="owned-container" ref={setContainer} />
      <OverlayScopeProvider value={{ id: 'synthetic-owner', zIndex: 1400, active, container,
        themeStyle: { '--zero-theme-font-body': 'serif', '--popover': '#aabbcc' } as React.CSSProperties }}>
        <div id="owned-anchor-source" style={{ '--zero-theme-font-body': 'monospace', '--popover': '#445566' } as React.CSSProperties}>
          <Popover open={ownedOpen} onOpenChange={changeOwnedOpen}>
            <PopoverTrigger asChild><button type="button" data-testid="owned-trigger">Owned surface</button></PopoverTrigger>
            <PopoverContent data-testid="owned-content" style={overrides}><input aria-label="Owned draft" /></PopoverContent>
          </Popover>
        </div>
      </OverlayScopeProvider>
      <button type="button" data-testid="outside">Outside</button>
      <button type="button" onClick={event => modals.show({ title: 'Parent anchored owner', trigger: event.currentTarget,
        body: context => <OwnedMenu context={context} kind="parent" /> })}>Open modal owner</button>
    </main>
  </ModalManager>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
Object.assign(window, { __anchoredSurface: {
  configure: (config: Partial<Configuration>) => configure(config), open: (open: boolean) => setOpen(open),
  active: (active: boolean) => setOwnerActive(active), overrides: (style: React.CSSProperties) => setOverrides(style),
  changes: () => [...changes], refs: () => ({ triggerMounts: refs.triggerMounts, contentMounts: refs.contentMounts,
    triggerMatches: refs.trigger === document.querySelector('[data-testid="anchor-trigger"]'),
    contentMatches: refs.content === document.querySelector('[data-testid="anchor-content"]') }),
  registered: () => hasOwnedFloatingOverlay('synthetic-owner'),
} });
