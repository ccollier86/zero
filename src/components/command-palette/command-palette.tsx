'use client';

/** Rich, instance-local command presentation. cmdk owns selection; Zero's manager owns the dialog. */
import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Search } from '../animate-ui/icons/search';
import { ControlledModal } from '../../modals/modal-controlled';
import type { ModalContext } from '../../modals/modal-system.types';
import { Command, CommandInput, CommandList, CommandItem } from '../ui/command';
import { Button, type ButtonProps } from '../ui/button';
import { Kbd, KbdGroup } from '../kbd';
import { ScrollArea } from '../ui/scroll-area';
import { MenuActiveHighlight } from '../overlays/menu-active-highlight';
import { cn } from '../../lib/utils';
import './command-palette.css';

export interface CommandPaletteGroup { id: string; label: string; icon?: React.ReactNode; prefix?: string }
export interface CommandPaletteController { isOpen: boolean; query: string; open: (origin?: Element | null) => void; close: () => void; toggle: (origin?: Element | null) => void; setQuery: (query: string) => void }
const PaletteContext = React.createContext<CommandPaletteController | null>(null);
export function useCommandPalette() { const controller = React.useContext(PaletteContext); if (!controller) throw new Error('useCommandPalette requires a CommandPaletteProvider.'); return controller; }
export interface CommandPaletteItem<T = unknown> {
  id: string; label: string; description?: string; group?: string; keywords?: readonly string[];
  icon?: React.ReactNode; image?: React.ReactNode; trailing?: React.ReactNode; disabled?: boolean; data?: T;
}
export interface CommandPaletteProps<T = unknown> {
  items: readonly CommandPaletteItem<T>[]; groups?: readonly CommandPaletteGroup[];
  title?: string; description?: string; placeholder?: string;
  open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void;
  /** false for caller-owned open state; otherwise this is content inside the shared trigger button. */
  trigger?: React.ReactNode | false; origin?: Element | null;
  /** Explicit opt-in: multiple palettes must not compete for a global shortcut. Editable fields are excluded. */
  shortcut?: boolean;
  query?: string; onQueryChange?: (query: string) => void;
  filterMode?: 'client' | 'manual'; loading?: boolean; empty?: React.ReactNode; maxResults?: number;
  sidebarExtra?: React.ReactNode; footer?: React.ReactNode; className?: string; style?: React.CSSProperties;
  renderItem?: (item: CommandPaletteItem<T>) => React.ReactNode;
  onSelect?: (item: CommandPaletteItem<T>, context: { signal: AbortSignal }) => void | boolean | Promise<void | boolean>;
  onSelectionError?: (error: unknown) => void;
}
export function filterCommandPaletteItems<T>(items: readonly CommandPaletteItem<T>[], query: string, group?: string, limit = 20) {
  const terms = query.slice(0, 256).normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  const maximum = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 20));
  const matches: CommandPaletteItem<T>[] = [];
  for (const item of items) {
    if (group && item.group !== group) continue;
    const text = [item.label, item.description, ...(item.keywords ?? [])].join(' ').normalize('NFKC').toLocaleLowerCase();
    if (terms.every(term => text.includes(term))) matches.push(item);
    if (matches.length >= maximum) break;
  }
  return matches;
}
export function CommandPaletteTrigger({ children, className, shortcut = false, onClick, ...props }: ButtonProps & { shortcut?: boolean }) {
  const controller = React.useContext(PaletteContext);
  return <Button type="button" variant="outline" {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented && !onClick) controller?.open(event.currentTarget); }} className={cn('zero-command-palette-trigger', className)}>
    {children ?? <><Search aria-hidden="true" /><span>Search…</span>{shortcut && <KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>}</>}
  </Button>;
}
export function CommandPalette<T = unknown>(props: CommandPaletteProps<T>) {
  const inheritedController = React.useContext(PaletteContext);
  const [localOpen, setLocalOpen] = React.useState(props.defaultOpen ?? false), [trigger, setTrigger] = React.useState<HTMLElement | null>(null);
  const open = props.open ?? localOpen;
  const changeOpen = React.useCallback((next: boolean) => { if (props.open === undefined) setLocalOpen(next); props.onOpenChange?.(next); }, [props.open, props.onOpenChange]);
  React.useEffect(() => {
    if (!props.shortcut) return;
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.repeat || !(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'k'
        || target instanceof HTMLElement && target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]')) return;
      event.preventDefault(); changeOpen(!open);
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [props.shortcut, open, changeOpen]);
  return <>
    {props.trigger !== false && <CommandPaletteTrigger ref={setTrigger} shortcut={props.shortcut} style={props.style} aria-label={props.title ?? 'Search'} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => changeOpen(true)}>{props.trigger}</CommandPaletteTrigger>}
    <ControlledModal open={open} onOpenChange={changeOpen} descriptor={{ title: props.title ?? 'Search', description: props.description,
      trigger: props.origin ?? trigger, size: 'lg', customSize: { width: String((props.style as Record<string, unknown> | undefined)?.['--zero-command-palette-width'] ?? 'var(--zero-command-palette-width,48rem)') },
      initialFocus: '[cmdk-input]', className: cn('zero-command-palette', props.className),
      body: context => <PaletteContext.Provider value={inheritedController}><div style={props.style}><CommandPaletteSurface {...props} context={context} /></div></PaletteContext.Provider> }} />
  </>;
}
export interface CommandPaletteProviderProps<T = unknown> extends Omit<CommandPaletteProps<T>, 'trigger' | 'origin'> { children: React.ReactNode; clearOnClose?: boolean }
/** Optional application-owned controller, never a process/global command store. */
export function CommandPaletteProvider<T = unknown>({ children, clearOnClose = true, ...props }: CommandPaletteProviderProps<T>) {
  const [localOpen, setOpen] = React.useState(props.defaultOpen ?? false), [localQuery, setQuery] = React.useState(''), [origin, setOrigin] = React.useState<Element | null>(null);
  const open = props.open ?? localOpen, query = props.query ?? localQuery;
  const changeQuery = (value: string) => { const bounded = value.slice(0, 256); if (props.query === undefined) setQuery(bounded); props.onQueryChange?.(bounded); };
  const changeOpen = (value: boolean) => { if (props.open === undefined) setOpen(value); props.onOpenChange?.(value); };
  const previousOpen = React.useRef(open);
  React.useEffect(() => { if (previousOpen.current && !open && clearOnClose) changeQuery(''); previousOpen.current = open; }, [open, clearOnClose]);
  const controller: CommandPaletteController = { isOpen: open, query, setQuery: changeQuery, open: element => { setOrigin(element ?? null); changeOpen(true); }, close: () => changeOpen(false), toggle: element => { setOrigin(element ?? null); changeOpen(!open); } };
  return <PaletteContext.Provider value={controller}>{children}<CommandPalette {...props} trigger={false} origin={origin} open={open} onOpenChange={changeOpen} query={query} onQueryChange={changeQuery} /></PaletteContext.Provider>;
}
function CommandPaletteSurface<T>({ context, ...props }: CommandPaletteProps<T> & { context: ModalContext }) {
  const [localQuery, setQuery] = React.useState(''), [selectedGroup, setGroup] = React.useState<string | undefined>(), [pending, setPending] = React.useState(false), [error, setError] = React.useState(false);
  const [sidebar, setSidebar] = React.useState<HTMLDivElement | null>(null);
  const selecting = React.useRef(false);
  const query = props.query ?? localQuery, groups = props.groups ?? [];
  const prefix = groups.find(group => group.prefix && query.startsWith(group.prefix));
  const active = prefix?.id ?? (groups.some(group => group.id === selectedGroup) ? selectedGroup : undefined);
  const searchable = prefix?.prefix ? query.slice(prefix.prefix.length) : query;
  const results = filterCommandPaletteItems(props.items, props.filterMode === 'manual' ? '' : searchable, active, props.maxResults);
  const select = async (item: CommandPaletteItem<T>) => {
    if (selecting.current || item.disabled || context.signal.aborted) return;
    selecting.current = true;
    setError(false); setPending(true); context.setBusy(true);
    try { const result = await props.onSelect?.(item, { signal: context.signal }); if (result !== false && !context.signal.aborted) context.accept(item.id); }
    catch (cause) { if (!context.signal.aborted) setError(true); try { props.onSelectionError?.(cause); } catch { /* An observer cannot break the dialog lifecycle. */ } }
    finally { selecting.current = false; if (!context.signal.aborted) { setPending(false); context.setBusy(false); } }
  };
  return <Command shouldFilter={false} label={props.title ?? 'Search'} className="zero-command-palette-command">
    <CommandInput placeholder={props.placeholder ?? 'Search…'} value={query} disabled={pending}
      onValueChange={value => { const bounded = value.slice(0, 256); if (props.query === undefined) setQuery(bounded); props.onQueryChange?.(bounded); }} />
    <div className="zero-command-palette-panels">
      {!!groups.length && <ScrollArea className="zero-command-palette-sidebar" scrollChaining="auto"><div ref={setSidebar} className="zero-command-palette-filters" aria-label="Search filters">
        <Button variant="ghost" type="button" disabled={pending} data-active={!active || undefined} onClick={() => { setGroup(undefined); if (prefix) { setQuery(searchable); props.onQueryChange?.(searchable); } }}><Search /><span>All</span></Button>
        {groups.map(group => <Button key={group.id} variant="ghost" type="button" disabled={pending} data-active={active === group.id || undefined}
          onClick={() => { setGroup(group.id); if (prefix) { setQuery(searchable); props.onQueryChange?.(searchable); } }}>{group.icon}<span>{group.label}</span>{group.prefix && <Kbd>{group.prefix}</Kbd>}</Button>)}
        <MenuActiveHighlight container={sidebar} activeSelector='[data-active="true"]' hoverSelector="button" preserveSelectionFill={false} />
        {props.sidebarExtra}
      </div></ScrollArea>}
      <div className="zero-command-palette-results-frame"><CommandList className="zero-command-palette-results" aria-busy={props.loading || pending}>
        {props.loading ? <p role="status" className="zero-command-palette-empty">Searching…</p> : results.length ? results.map(item => <CommandItem key={item.id} value={item.id} disabled={pending || item.disabled} onSelect={() => { void select(item); }} className="zero-command-palette-result">
          {props.renderItem ? props.renderItem(item) : <><span className="zero-command-palette-result-icon">{item.image ?? item.icon}</span><span className="zero-command-palette-result-copy"><strong>{item.label}</strong>{item.description && <span>{item.description}</span>}</span>{item.trailing ?? <ArrowUpRight aria-hidden="true" />}</>}
        </CommandItem>) : <div role="status" className="zero-command-palette-empty">{props.empty ?? 'No results found. Try another search.'}</div>}
      </CommandList></div>
    </div>
    {error && <p role="alert" className="zero-command-palette-error">That action could not be completed. Try again.</p>}
    {props.footer !== false && <footer className="zero-command-palette-footer">{props.footer ?? <><span><Kbd>↑↓</Kbd> Navigate</span><span><Kbd>↵</Kbd> Select</span><span><Kbd>Esc</Kbd> Close</span></>}</footer>}
  </Command>;
}
