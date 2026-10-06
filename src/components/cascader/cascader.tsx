'use client';

/** Accessible popup composition over Zero's established Popover and Command primitives. */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';
import { Command } from '../ui/command';
import { Button, type ButtonProps } from '../ui/button';
import { cn } from '../../lib/utils';
import { CascaderContext, useCascaderView } from './cascader-context';
import { useCascaderController } from './use-cascader-controller';
import type { CascaderProps } from './cascader.props';

/** One nested selection state; compose the popup and optional external chips as siblings. */
export function Cascader<T = unknown>(props: CascaderProps<T>) {
  if (props.max !== undefined && (!Number.isSafeInteger(props.max) || props.max < 0)) {
    throw new RangeError('Cascader max must be a nonnegative safe integer.');
  }
  if (props.searchDebounce !== undefined && (!Number.isSafeInteger(props.searchDebounce) || props.searchDebounce < 0 || props.searchDebounce > 60_000)) {
    throw new RangeError('Cascader searchDebounce must be an integer between 0 and 60000 milliseconds.');
  }
  const view = useCascaderController(props as unknown as CascaderProps);
  return <CascaderContext.Provider value={view}>
    <Popover open={view.open} onOpenChange={view.setOpen}>
      {props.children}
      {props.name && (view.multiple ? view.values : [view.values[0] ?? '']).map((value, index) =>
        <input key={`${value}:${index}`} type="hidden" name={props.name} value={value} disabled={view.disabled} />)}
    </Popover>
  </CascaderContext.Provider>;
}

/** Standard Zero button trigger; supply an explicit field name through root label or aria-label. */
export function CascaderTrigger({ children, className, disabled, ...props }: ButtonProps) {
  const view = useCascaderView();
  return <PopoverTrigger asChild>
    <Button type="button" variant="outline" id={view.id} aria-label={view.label}
      disabled={view.disabled || disabled} data-slot="cascader-trigger"
      className={cn('min-w-0 justify-between gap-3', className)} {...props}>
      {children}<ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </Button>
  </PopoverTrigger>;
}

/** Popup stays within the viewport; nested footer menus own the first dismissal layer. */
export function CascaderContent({ className, onInteractOutside, onEscapeKeyDown, ...props }: React.ComponentProps<typeof PopoverContent>) {
  const view = useCascaderView();
  return <PopoverContent align="start" aria-label={`${view.label} options`} data-slot="cascader-content"
    className={cn('flex w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0', className)}
    onInteractOutside={(event) => { if (view.menuOpen) event.preventDefault(); onInteractOutside?.(event); }}
    onEscapeKeyDown={(event) => { if (view.menuOpen) event.preventDefault(); onEscapeKeyDown?.(event); }}
    {...props} />;
}

/** Search/list/footer share one bounded command surface; only the list scrolls. */
export function CascaderPanel({ className, children, ...props }: React.ComponentProps<typeof Command>) {
  const view = useCascaderView();
  return <Command label={`Search ${view.label}`} shouldFilter={false} data-slot="cascader-panel"
    className={cn('max-h-[min(32rem,var(--radix-popover-content-available-height))] min-h-0 w-full rounded-xl', className)} {...props}>
    {children}
    <span role="status" aria-live="polite" className="sr-only">{view.status}</span>
  </Command>;
}
