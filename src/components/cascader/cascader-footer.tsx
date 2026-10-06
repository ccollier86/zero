'use client';

/** Pinned footer and guarded async commands; apps own import semantics and persistence. */
import * as React from 'react';
import { ChevronRight, Download, LoaderCircle } from 'lucide-react';
import { Button, type ButtonProps } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../dropdown-menu';
import { cn } from '../../lib/utils';
import { useIsMobile } from '../../hooks/use-mobile';
import { useCascaderView } from './cascader-context';

/** Footer remains reachable through filtering, loading, empty levels and scrolling. */
export function CascaderFooter({ className, children, ...props }: React.ComponentProps<'div'>) {
  const view = useCascaderView();
  return <div data-slot="cascader-footer" className={cn('shrink-0 border-t border-border bg-muted/25 p-1.5', className)} {...props}>
    {view.multiple && <p id={`${view.id}-limit`} className="px-2 pb-1 pt-0.5 text-xs text-muted-foreground">
      {view.max === undefined ? `${view.values.length} selected` : `${view.values.length} / ${view.max} selected`}
    </p>}
    {children}
    {view.callbackError && <p role="alert" className="px-2 py-1 text-xs text-destructive">{view.status}</p>}
  </div>;
}

/** Await one footer action at a time; catch errors through Zero and never close a new scope's popup. */
export function CascaderAction({ onSelect, children, disabled, ...props }:
  Omit<ButtonProps, 'onSelect'> & { onSelect?: () => void | Promise<void> }) {
  const action = useFooterAction();
  return <Button type="button" variant="ghost" size="sm" className="w-full justify-start"
    disabled={disabled || action.disabled || action.pending} aria-busy={action.pending || undefined} {...props}
    onClick={(event) => { props.onClick?.(event); if (!event.defaultPrevented) void action.run(onSelect); }}>
    {action.pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{children}
  </Button>;
}

/** An app-owned import action. This menu never guesses permissions or reads files itself. */
export interface CascaderImportAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

/** Side-anchored import menu reuses Zero's accessible, collision-aware dropdown menu. */
export function CascaderImportMenu({ actions, label = 'Import', disabled = false }:
  { actions: readonly CascaderImportAction[]; label?: string; disabled?: boolean }) {
  const view = useCascaderView();
  const action = useFooterAction();
  const mobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { setOpen(false); }, [view.generation]);
  React.useEffect(() => () => view.setMenuOpen(false), []);
  const changeOpen = (next: boolean) => { setOpen(next); view.setMenuOpen(next); };
  return <DropdownMenu modal={false} open={open} onOpenChange={changeOpen}>
    <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="sm" className="w-full justify-start"
      disabled={disabled || action.disabled || !actions.length || action.pending}>
      <Download aria-hidden="true" className="size-4" />{label}<ChevronRight className="ml-auto size-4" aria-hidden="true" />
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent side={mobile ? 'bottom' : 'right'} align="end" sideOffset={8}
      collisionPadding={8} className="min-w-48 max-w-[calc(100vw-2rem)]" aria-label={label}>
      {actions.map((item) => <DropdownMenuItem key={item.id} disabled={disabled || action.disabled || item.disabled || action.pending}
        onSelect={(event) => {
          event.preventDefault();
          void action.run(item.onSelect).then((success) => { if (success) changeOpen(false); });
        }}>{item.icon}{item.label}{action.pending && <LoaderCircle className="ml-auto size-3 animate-spin" aria-hidden="true" />}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function useFooterAction() {
  const view = useCascaderView();
  const [pending, setPending] = React.useState(false);
  const current = React.useRef(view); current.current = view;
  const active = React.useRef(false), mounted = React.useRef(true);
  const operation = React.useRef(0);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current++; }; }, []);
  React.useEffect(() => { operation.current++; active.current = false; setPending(false); }, [view.generation]);
  const run = async (callback: (() => void | Promise<void>) | undefined): Promise<boolean> => {
    if (active.current || current.current.disabled || current.current.readOnly) return false;
    const owner = current.current.generation;
    const intent = ++operation.current;
    active.current = true; setPending(true);
    const isCurrent = () => mounted.current && owner === current.current.generation && intent === operation.current;
    try { await callback?.(); return isCurrent(); }
    catch {
      if (isCurrent()) current.current.reportCallbackError('footer');
      return false;
    } finally {
      if (isCurrent()) { active.current = false; setPending(false); }
    }
  };
  return { pending, run, disabled: view.disabled || view.readOnly };
}
