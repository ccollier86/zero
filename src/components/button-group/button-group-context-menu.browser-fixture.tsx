/** Synthetic composition only: no application, data source or persistence callbacks. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Copy, Folder, MoreHorizontal, Trash2 } from 'lucide-react';
import { ButtonGroup, ButtonGroupText, ButtonGroupSeparator, ButtonGroupToggle, ButtonGroupToggleItem } from './index';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuLabel, ContextMenuItem,
  ContextMenuCheckboxItem, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuSeparator,
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuShortcut } from '../context-menu/index';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../animate-ui/components/radix/dropdown-menu';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../animate-ui/components/radix/dialog';

function Groups() {
  const [single, setSingle] = React.useState('list'), [multiple, setMultiple] = React.useState<string[]>([]);
  return <section aria-label="Joined controls" className="space-y-5 rounded-xl border border-border bg-card p-5">
    <div><h2 className="text-base font-semibold">Button groups</h2><p className="text-sm text-muted-foreground">Joined actions, addons and keyboard selection.</p></div>
    <ButtonGroup aria-label="Horizontal actions" data-testid="joined-horizontal">
      <Button variant="outline">Save</Button><Button variant="outline">Archive</Button><Button variant="outline">Delete</Button>
    </ButtonGroup>
    <div className="flex flex-wrap items-start gap-5">
      <ButtonGroup orientation="vertical" aria-label="Vertical actions" data-testid="joined-vertical">
        <Button variant="outline">First</Button><Button variant="outline">Second</Button><Button variant="outline">Third</Button>
      </ButtonGroup>
      <ButtonGroup data-testid="nested-group" aria-label="Nested actions">
        <ButtonGroup aria-label="Primary nested actions"><Button variant="outline">Undo</Button><Button variant="outline">Redo</Button></ButtonGroup>
        <ButtonGroupSeparator /><ButtonGroup aria-label="Secondary nested actions"><Button variant="outline">Copy</Button><Button variant="outline">Paste</Button></ButtonGroup>
      </ButtonGroup>
    </div>
    <div><ButtonGroup data-testid="input-group" aria-label="Website address" className="w-full max-w-md">
      <ButtonGroupText>https://</ButtonGroupText><Input aria-label="Website hostname" defaultValue="zero.example" />
      <Button variant="outline" aria-label="Copy address"><Copy className="size-4" aria-hidden="true" /></Button>
    </ButtonGroup></div>
    <div><ButtonGroup data-testid="split-group" aria-label="Split publishing action">
      <Button variant="outline">Publish</Button><ButtonGroupSeparator />
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Publishing options"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem>Publish later</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </ButtonGroup></div>
    <div><ButtonGroup data-testid="select-group" aria-label="Select addon">
      <ButtonGroupText>Scope</ButtonGroupText><Select defaultValue="workspace"><SelectTrigger aria-label="Action scope"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="workspace">Workspace</SelectItem><SelectItem value="selected">Selected records</SelectItem></SelectContent></Select>
      <Button variant="outline">Apply scope</Button>
    </ButtonGroup></div>
    <div><ButtonGroup data-testid="rtl-group" dir="rtl" aria-label="Right to left actions"><Button variant="outline">RTL first</Button><Button variant="outline">RTL middle</Button><Button variant="outline">RTL last</Button></ButtonGroup></div>
    <div><ButtonGroup asChild><fieldset disabled aria-label="Disabled actions" data-testid="disabled-group"><Button variant="outline">Disabled save</Button><Button variant="outline">Disabled archive</Button></fieldset></ButtonGroup></div>
    <div className="flex flex-wrap items-start gap-4">
      <ButtonGroupToggle type="single" value={single} onValueChange={setSingle} aria-label="View mode" data-testid="single-toggle">
        <ButtonGroupToggleItem value="list">List</ButtonGroupToggleItem><ButtonGroupToggleItem value="grid">Grid</ButtonGroupToggleItem><ButtonGroupToggleItem value="table" disabled>Table</ButtonGroupToggleItem>
      </ButtonGroupToggle>
      <ButtonGroupToggle type="multiple" value={multiple} onValueChange={setMultiple} aria-label="Text formatting" data-testid="multiple-toggle">
        <ButtonGroupToggleItem value="bold">Bold</ButtonGroupToggleItem><ButtonGroupToggleItem value="italic">Italic</ButtonGroupToggleItem><ButtonGroupToggleItem value="underline" disabled>Underline</ButtonGroupToggleItem>
      </ButtonGroupToggle>
      <ButtonGroupToggle type="single" defaultValue="top" orientation="vertical" aria-label="Vertical alignment" data-testid="vertical-toggle">
        <ButtonGroupToggleItem value="top">Top</ButtonGroupToggleItem><ButtonGroupToggleItem value="middle">Middle</ButtonGroupToggleItem><ButtonGroupToggleItem value="bottom">Bottom</ButtonGroupToggleItem>
      </ButtonGroupToggle>
    </div>
    <output data-testid="selection" className="block text-xs text-muted-foreground">{JSON.stringify({ single, multiple })}</output>
  </section>;
}

function Menus() {
  const [actions, setActions] = React.useState<string[]>([]), [archived, setArchived] = React.useState(false);
  const [mixed, setMixed] = React.useState<boolean | 'indeterminate'>('indeterminate'), [sort, setSort] = React.useState('name');
  const [details, setDetails] = React.useState(false), [innerChecked, setInnerChecked] = React.useState(false);
  const pendingDetails = React.useRef(false);
  const record = (value: string) => setActions(previous => [...previous, value]);
  return <section aria-label="Contextual controls" className="space-y-5 rounded-xl border border-border bg-card p-5">
    <div><h2 className="text-base font-semibold">Context menus</h2><p className="text-sm text-muted-foreground">Right click or press Shift+F10 on a focused target.</p></div>
    <ContextMenu><ContextMenuTrigger asChild><Button variant="outline" data-testid="record-target">Record actions</Button></ContextMenuTrigger>
      <ContextMenuContent data-testid="record-menu" className="w-64" onCloseAutoFocus={event => {
        if (pendingDetails.current) { pendingDetails.current = false; event.preventDefault(); setDetails(true); }
      }}>
        <ContextMenuLabel>Record <Badge variant="secondary" className="ml-2 text-[10px]">3</Badge></ContextMenuLabel>
        <ContextMenuItem icon={<Copy className="size-4 text-primary" data-testid="copy-icon" />} onSelect={() => record('copy')}
          endAdornment={<ContextMenuShortcut>⌘C</ContextMenuShortcut>}>Copy record</ContextMenuItem>
        <ContextMenuItem disabled onSelect={() => record('disabled')}>Disabled action</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem checked={archived} onCheckedChange={value => setArchived(value === true)} indicatorPosition="right"
          onSelect={event => event.preventDefault()}>Show archived</ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem checked indicatorPosition="left" onSelect={event => event.preventDefault()}>Show grid</ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem checked={mixed} onCheckedChange={setMixed} indicatorPosition="left"
          onSelect={event => event.preventDefault()}>Mixed permissions</ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuRadioGroup value={sort} onValueChange={setSort}>
          <ContextMenuRadioItem value="name" indicatorPosition="left" onSelect={event => event.preventDefault()}>Sort by name</ContextMenuRadioItem>
          <ContextMenuRadioItem value="date" indicatorPosition="right" onSelect={event => event.preventDefault()}>Sort by date</ContextMenuRadioItem>
        </ContextMenuRadioGroup>
        <ContextMenuSub><ContextMenuSubTrigger icon={<Folder className="size-4 text-warning" />}
          endAdornment={<Badge variant="outline" className="text-[10px]">2</Badge>}>Move to</ContextMenuSubTrigger>
          <ContextMenuSubContent data-testid="submenu"><ContextMenuItem onSelect={() => record('team')}>Team workspace</ContextMenuItem>
            <ContextMenuSub><ContextMenuSubTrigger>Projects</ContextMenuSubTrigger><ContextMenuSubContent data-testid="nested-submenu">
              <ContextMenuItem onSelect={() => record('project')}>Project Alpha</ContextMenuItem></ContextMenuSubContent></ContextMenuSub>
          </ContextMenuSubContent></ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={event => { event.preventDefault(); record('keep'); }}>Keep menu open</ContextMenuItem>
        <ContextMenuItem onSelect={() => { pendingDetails.current = true; }}>Open details</ContextMenuItem>
        <ContextMenuItem variant="destructive" icon={<Trash2 className="size-4" />} onSelect={() => record('delete')}>Delete record</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
    <div className="flex flex-wrap gap-3">
      <ContextMenu><ContextMenuTrigger asChild disabled><Button variant="outline" data-testid="disabled-target">Disabled menu target</Button></ContextMenuTrigger>
        <ContextMenuContent><ContextMenuItem>Should not open disabled</ContextMenuItem></ContextMenuContent></ContextMenu>
      <ContextMenu><ContextMenuTrigger asChild onContextMenu={event => event.preventDefault()} onKeyDown={event => {
        if (event.key === 'F10' || event.key === 'ContextMenu') event.preventDefault();
      }}><Button variant="outline" data-testid="prevented-target">Prevented menu target</Button></ContextMenuTrigger>
        <ContextMenuContent><ContextMenuItem>Should not open prevented</ContextMenuItem></ContextMenuContent></ContextMenu>
      <ContextMenu><ContextMenuTrigger asChild><Button variant="outline" data-testid="long-target">Long list menu</Button></ContextMenuTrigger>
        <ContextMenuContent data-testid="long-menu" className="w-56">{Array.from({ length: 48 }, (_, index) =>
          <ContextMenuItem key={index} onSelect={() => record(`long-${index}`)}>Action {String(index + 1).padStart(2, '0')}</ContextMenuItem>)}</ContextMenuContent>
      </ContextMenu>
    </div>
    <ContextMenu><ContextMenuTrigger asChild><Button variant="outline" className="fixed bottom-3 right-3 z-10" data-testid="edge-target">Edge menu</Button></ContextMenuTrigger>
      <ContextMenuContent data-testid="edge-menu" className="w-64"><ContextMenuItem>Edge first</ContextMenuItem><ContextMenuItem>Edge second</ContextMenuItem></ContextMenuContent></ContextMenu>
    <Dialog open={details} onOpenChange={setDetails}><DialogContent><DialogHeader><DialogTitle>Record details</DialogTitle>
      <DialogDescription>Opened after the menu completes close focus.</DialogDescription></DialogHeader><Input aria-label="Record detail name" /></DialogContent></Dialog>
    <Dialog><DialogTrigger asChild><Button variant="outline">Open host dialog</Button></DialogTrigger>
      <DialogContent data-testid="host-dialog"><DialogHeader><DialogTitle>Host dialog</DialogTitle><DialogDescription>Portal and focus ownership fixture.</DialogDescription></DialogHeader>
        <ContextMenu><ContextMenuTrigger asChild><Button variant="outline" data-testid="inner-target">Inner menu</Button></ContextMenuTrigger>
          <ContextMenuContent data-testid="inner-menu"><ContextMenuCheckboxItem checked={innerChecked} onCheckedChange={value => setInnerChecked(value === true)}
            onSelect={event => event.preventDefault()}>Inner setting</ContextMenuCheckboxItem><ContextMenuItem onSelect={() => record('inner')}>Inner action</ContextMenuItem></ContextMenuContent></ContextMenu>
        <Input aria-label="Host dialog field" />
      </DialogContent>
    </Dialog>
    <output data-testid="menu-actions" className="block text-xs text-muted-foreground">{JSON.stringify(actions)}</output>
  </section>;
}

/** Exercises the public native surface contract independently of its animation implementation. */
function NativeSurfaceProbe() {
  const native = React.useRef<HTMLDivElement>(null), slotted = React.useRef<HTMLDivElement>(null);
  const owned = React.useRef<HTMLDivElement>(null);
  const child = React.useRef<HTMLElement>(null);
  const [childTag, setChildTag] = React.useState<'section' | 'article'>('section');
  const [callbackRefs, setCallbackRefs] = React.useState(false);
  const refEvents = React.useRef<Array<{ owner: 'public' | 'child'; phase: 'attach' | 'cleanup'; tag: string }>>([]);
  const ChildTag = childTag;
  const publicCallback = React.useCallback((node: HTMLDivElement | null) => {
    slotted.current = node;
    if (!node) return;
    refEvents.current.push({ owner: 'public', phase: 'attach', tag: node.tagName });
    return () => { refEvents.current.push({ owner: 'public', phase: 'cleanup', tag: node.tagName }); if (slotted.current === node) slotted.current = null; };
  }, []);
  const childCallback = React.useCallback((node: HTMLElement | null) => {
    child.current = node;
    if (!node) return;
    refEvents.current.push({ owner: 'child', phase: 'attach', tag: node.tagName });
    return () => { refEvents.current.push({ owner: 'child', phase: 'cleanup', tag: node.tagName }); if (child.current === node) child.current = null; };
  }, []);
  const events = React.useRef<Array<{ surface: string; kind: string; native: boolean; target: boolean }>>([]);
  React.useLayoutEffect(() => {
    window.__groupedSurfaceProbe = { ref: surface => surface === 'native' ? native.current : surface === 'owned' ? owned.current : slotted.current,
      child: () => child.current, events: () => events.current, replaceChild: () => setChildTag('article'),
      useCallbackRefs: () => setCallbackRefs(true), refEvents: () => refEvents.current };
    return () => { delete window.__groupedSurfaceProbe; };
  }, []);
  const handlers = (surface: string) => ({
    onAnimationStart: (event: React.AnimationEvent<HTMLDivElement>) => events.current.push({ surface, kind: 'animation',
      native: event.nativeEvent instanceof AnimationEvent, target: event.currentTarget === (surface === 'native' ? native.current : slotted.current) }),
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => events.current.push({ surface, kind: 'drag',
      native: event.nativeEvent instanceof DragEvent, target: event.currentTarget === (surface === 'native' ? native.current : slotted.current) }),
  });
  return <section aria-label="Native menu surfaces" data-testid="surface-probe" data-ref-mode={callbackRefs ? 'callback' : 'object'}
    className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-5">
    <ContextMenu><ContextMenuTrigger asChild><Button variant="outline" data-testid="native-surface-target">Native surface</Button></ContextMenuTrigger>
      <ContextMenuContent ref={native} data-testid="native-surface-menu" data-consumer="retained" {...handlers('native')}>
        <ContextMenuItem>Native surface action</ContextMenuItem>
      </ContextMenuContent></ContextMenu>
    <ContextMenu><ContextMenuTrigger asChild><Button variant="outline" data-testid="slotted-surface-target">Slotted surface</Button></ContextMenuTrigger>
      <ContextMenuContent asChild ref={callbackRefs ? publicCallback : slotted} data-testid="slotted-surface-menu" data-consumer="retained"
        style={{ opacity: 0.65, transform: 'translateX(2px)' }} {...handlers('slotted')}>
        <ChildTag ref={callbackRefs ? childCallback : child} data-child="retained" aria-label="Slotted menu surface"><ContextMenuItem>Slotted surface action</ContextMenuItem></ChildTag>
      </ContextMenuContent></ContextMenu>
    <ContextMenu><ContextMenuTrigger asChild><Button variant="outline" data-testid="owned-surface-target">Child-owned surface</Button></ContextMenuTrigger>
      <ContextMenuContent asChild ref={owned} data-testid="owned-surface-menu"><SelfReplacingSurface /></ContextMenuContent>
    </ContextMenu>
  </section>;
}

/** A valid asChild consumer can replace its own DOM without rerendering its parent adapter. */
function SelfReplacingSurface({ ref, ...props }: React.ComponentProps<'section'>) {
  const [tag, setTag] = React.useState<'section' | 'article'>('section');
  const child = React.useRef<HTMLElement>(null), Tag = tag;
  React.useLayoutEffect(() => {
    window.__ownedSurfaceProbe = { replace: () => setTag('article'), child: () => child.current };
    return () => { delete window.__ownedSurfaceProbe; };
  }, []);
  const merged = React.useCallback((node: HTMLElement | null) => {
    child.current = node;
    const cleanup = typeof ref === 'function' ? ref(node) : ref ? (ref.current = node, undefined) : undefined;
    return () => {
      if (child.current === node) child.current = null;
      if (typeof cleanup === 'function') cleanup();
      else if (typeof ref === 'function') ref(null);
      else if (ref) ref.current = null;
    };
  }, [ref]);
  return <Tag {...props} ref={merged}><ContextMenuItem onSelect={event => { event.preventDefault(); setTag('article'); }}>Replace owned surface</ContextMenuItem></Tag>;
}

createRoot(document.getElementById('root')!).render(<main data-testid="fixture-ready" className="mx-auto min-h-screen max-w-5xl space-y-6 p-5 text-foreground sm:p-8">
  <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Grouped controls laboratory</h1>
    <p className="text-sm text-muted-foreground">Synthetic component acceptance fixture.</p></div><Button variant="outline" data-testid="outside-target">Outside focus target</Button></header>
  <Groups /><Menus /><NativeSurfaceProbe />
</main>);

declare global {
  interface Window {
    __groupedSurfaceProbe?: {
      ref(surface: 'native' | 'slotted' | 'owned'): HTMLElement | null;
      child(): HTMLElement | null;
      replaceChild(): void;
      useCallbackRefs(): void;
      refEvents(): readonly { owner: 'public' | 'child'; phase: 'attach' | 'cleanup'; tag: string }[];
      events(): readonly { surface: string; kind: string; native: boolean; target: boolean }[];
    };
    __ownedSurfaceProbe?: { replace(): void; child(): HTMLElement | null };
  }
}
