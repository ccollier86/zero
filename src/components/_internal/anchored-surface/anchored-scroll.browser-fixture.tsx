/** Disposable native menu/form scroll contracts; no application or external data. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '../../animate-ui/components/radix/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent, PopoverViewport, PopoverClose } from '../../surfaces/popover/popover';
import { OverlayScopeProvider, hasOwnedFloatingOverlay } from '../overlay-scope/overlay-scope';
import { TimePicker } from '../../ui/time-picker';
import { Calendar } from '../../ui/calendar';
import { Command, CommandInput, CommandList, CommandItem } from '../../ui/command';

type Configuration = { scale?: number; custom?: boolean; bounded?: boolean };
let configure!: (next: Configuration) => void;
let menu: HTMLDivElement | null = null, menuViewport: HTMLDivElement | null = null, subViewport: HTMLDivElement | null = null;
let popover: HTMLDivElement | null = null, popoverViewport: HTMLDivElement | null = null;
let selected = '', menuChanges: boolean[] = [], popoverChanges: boolean[] = [], cleanups = 0;
const menuRef: React.RefCallback<HTMLDivElement> = element => { menu = element; return () => { menu = null; cleanups++; }; };
const menuViewportRef: React.RefCallback<HTMLDivElement> = element => { menuViewport = element; return () => { menuViewport = null; cleanups++; }; };
const popoverRef: React.RefCallback<HTMLDivElement> = element => { popover = element; };
const popoverViewportRef: React.RefCallback<HTMLDivElement> = element => { popoverViewport = element; };

function Fixture() {
  const [config, setConfig] = React.useState({ scale: 1, custom: false, bounded: true });
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false), [formOpen, setFormOpen] = React.useState(false);
  configure = next => setConfig(previous => ({ ...previous, ...next }));
  const motion = config.custom ? { initial: { opacity: 0, scale: .91 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: .91 }, transition: { duration: .05 } } : {};
  return <main data-zero-theme-foundation="next" style={{ padding: 30 }}>
    <div id="scroll-portals" ref={setContainer} style={{ position: 'fixed', top: 0, left: 0, transform: `scale(${config.scale})`, transformOrigin: 'top left' }} />
    <OverlayScopeProvider value={{ id: 'anchored-scroll-owner', zIndex: 1400, active: true, container }}>
      <DropdownMenu open={open} onOpenChange={next => { menuChanges.push(next); setOpen(next); }}>
        <DropdownMenuTrigger asChild><button type="button" data-testid="scroll-menu-trigger">Long actions</button></DropdownMenuTrigger>
        <DropdownMenuContent ref={menuRef} viewportRef={menuViewportRef} data-testid="scroll-menu" className={config.bounded ? 'w-64 max-h-[180px]' : 'w-64'} scrollbars="always"
          viewportClassName="caller-menu-viewport" viewportStyle={{ '--caller-viewport': 'retained' } as React.CSSProperties} {...motion}>
          <DropdownMenuLabel>Record actions</DropdownMenuLabel>
          <DropdownMenuSub><DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger>
            <DropdownMenuSubContent data-testid="scroll-submenu" className="w-48 max-h-[150px]" scrollbars="always" viewportRef={element => { subViewport = element; }}>
              {Array.from({ length: 24 }, (_, i) => <DropdownMenuItem key={i} onSelect={() => { selected = `Sub ${i + 1}`; }}>Sub {i + 1}</DropdownMenuItem>)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {Array.from({ length: 30 }, (_, i) => <DropdownMenuItem key={i} disabled={i === 1} onSelect={() => { selected = `Action ${i + 1}`; }}>Action {i + 1}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover open={formOpen} onOpenChange={next => { popoverChanges.push(next); setFormOpen(next); }}>
        <PopoverTrigger asChild><button type="button" data-testid="scroll-popover-trigger">Long form</button></PopoverTrigger>
        <PopoverContent ref={popoverRef} data-testid="scroll-popover" className="flex h-64 w-72 flex-col overflow-hidden p-2" {...motion}>
          <form data-testid="scroll-form" className="flex min-h-0 flex-1 flex-col" onSubmit={event => event.preventDefault()}>
            <header data-testid="scroll-form-header" className="shrink-0">Fixed form header</header>
            <PopoverViewport ref={popoverViewportRef} data-testid="scroll-form-body" className="caller-form-body space-y-2" scrollbars="always" style={{ '--caller-body': 'retained' } as React.CSSProperties}>
              {Array.from({ length: 30 }, (_, i) => <label key={i} className="flex min-h-12 flex-col">Field {i + 1}<input name="entry" defaultValue={`Value ${i + 1}`} aria-label={`Field ${i + 1}`} /></label>)}
            </PopoverViewport>
            <footer data-testid="scroll-form-footer" className="shrink-0"><PopoverClose asChild><button type="button">Close form</button></PopoverClose></footer>
          </form>
        </PopoverContent>
      </Popover>
      <TimePicker aria-label="Existing time" value="17:45" />
      <Popover><PopoverTrigger asChild><button type="button" data-testid="existing-calendar-trigger">Existing calendar</button></PopoverTrigger>
        <PopoverContent data-testid="existing-calendar" className="w-auto p-0"><Calendar mode="single" defaultMonth={new Date(2026, 9, 1)} /></PopoverContent>
      </Popover>
      <Popover><PopoverTrigger asChild><button type="button" data-testid="existing-command-trigger">Existing commands</button></PopoverTrigger>
        <PopoverContent data-testid="existing-command" className="p-0"><Command label="Existing commands"><CommandInput />
          <CommandList>{Array.from({ length: 30 }, (_, i) => <CommandItem key={i}>Command {i + 1}</CommandItem>)}</CommandList>
        </Command></PopoverContent>
      </Popover>
    </OverlayScopeProvider>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
Object.assign(window, { __anchoredScroll: { configure: (next: Configuration) => configure(next), selected: () => selected,
  menu: () => menu, menuViewport: () => menuViewport, subViewport: () => subViewport, popover: () => popover, popoverViewport: () => popoverViewport,
  menuChanges: () => [...menuChanges], popoverChanges: () => [...popoverChanges], cleanups: () => cleanups, registered: () => hasOwnedFloatingOverlay('anchored-scroll-owner') } });
