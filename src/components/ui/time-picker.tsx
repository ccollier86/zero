/**
 * time-picker.tsx
 *
 * Composes Zero's popover and action primitives into an accessible time list.
 * Values stay canonical HH:mm; display format and motion never alter precision.
 */

'use client';

import * as React from 'react';
import { Clock3, ChevronDown, Check } from 'lucide-react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '#zero/lib/utils';
import { useControlledState } from '#zero/hooks/use-controlled-state';
import { useStableCallback } from '../../hooks/use-stable-callback';
import { Button } from '#zero/components/ui/button';
import { Input } from '#zero/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '#zero/components/animate-ui/components/radix/popover';
import { PickerValueText } from './picker-value-text';
import { usePickerPopoverMotion } from './picker-popover-motion';
import { formatTimePickerDisplay, parseTimeValue, timePickerOptions } from './time-picker-value';

/** Controlled canonical time field; empty values remain empty until deliberately picked. */
export interface TimePickerProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  minuteStep?: number;
  format?: '12h' | '24h';
  placeholder?: string;
  clearable?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  animateValue?: boolean;
  /** Style the shared trigger without selectors that depend on its internal markup. */
  triggerClassName?: string;
  className?: string;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/** Render a compact keyboard-operated time list without native date/time UI. */
export function TimePicker({
  value, onChange, disabled = false, readOnly = false, minuteStep = 1, format = '12h',
  placeholder = 'Select a time', clearable = true, open: controlledOpen, onOpenChange,
  animateValue = true, triggerClassName, className, id, name, 'aria-label': ariaLabel = 'Time',
  'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid,
}: TimePickerProps) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const listId = `${controlId}-options`;
  const notifyOpenChange = useStableCallback((next: boolean) => onOpenChange?.(next));
  const [open, setOpen] = useControlledState({ value: controlledOpen, defaultValue: false, onChange: notifyOpenChange });
  const options = React.useMemo(() => timePickerOptions(minuteStep, value), [minuteStep, value]);
  const [active, setActive] = React.useState(0);
  const activeIndex = Math.max(0, Math.min(options.length - 1, active));
  const listRef = React.useRef<HTMLDivElement>(null);
  const [list, setList] = React.useState<HTMLDivElement | null>(null);
  const bindList = React.useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    setList(element);
  }, []);
  const virtual = useVirtualizer<HTMLDivElement, HTMLButtonElement>({
    count: options.length, getScrollElement: () => list, estimateSize: () => 36, overscan: 8,
    getItemKey: index => options[index]!,
    rangeExtractor: range => Array.from(new Set([...defaultRangeExtractor(range), activeIndex])).sort((a, b) => a - b),
  });
  const centerOnOpen = React.useRef(false);
  const popupMotion = usePickerPopoverMotion();
  const parsed = parseTimeValue(value);
  const invalid = ariaInvalid || Boolean(value && !parsed);
  const display = value ? formatTimePickerDisplay(value, format) : placeholder;
  const available = !disabled && !readOnly;

  const requestOpen = React.useCallback((next: boolean) => {
    if (next && !available) return;
    if (next) {
      const selectedIndex = value ? options.indexOf(value) : -1;
      setActive(selectedIndex >= 0 ? selectedIndex : 0);
      centerOnOpen.current = true;
    }
    setOpen(next);
  }, [available, options, setOpen, value]);

  React.useEffect(() => { if (!available && open) setOpen(false); }, [available, open, setOpen]);
  React.useEffect(() => {
    if (!open) return;
    const selectedIndex = value ? options.indexOf(value) : -1;
    centerOnOpen.current = true;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [options, open, value]);
  React.useLayoutEffect(() => {
    if (!open || !list) return;
    virtual.scrollToIndex(activeIndex, { align: centerOnOpen.current ? 'center' : 'auto' });
    centerOnOpen.current = false;
  }, [open, activeIndex, options.length, virtual, list]);

  function choose(next: string) {
    if (!available) return;
    onChange?.(next);
    requestOpen(false);
  }

  function onListKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!available || event.nativeEvent.isComposing) return;
    const delta: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
    if (event.key in delta) {
      event.preventDefault(); event.stopPropagation();
      setActive(index => Math.max(0, Math.min(options.length - 1, index + delta[event.key]!)));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); event.stopPropagation(); setActive(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation(); const next = options[activeIndex]; if (next) choose(next);
    }
  }

  return <Popover open={open && available} onOpenChange={requestOpen}>
    <div data-slot="time-picker" data-readonly={readOnly || undefined} className={cn('min-w-0', className)}>
      {name ? <Input type="hidden" name={name} value={value ?? ''} readOnly disabled={disabled} /> : null}
      <PopoverTrigger asChild>
        <Button id={controlId} type="button" variant="outline" role="combobox" data-slot="time-picker-trigger"
          aria-label={ariaLabel} aria-haspopup="listbox" aria-controls={open ? listId : undefined}
          aria-expanded={open && available} aria-describedby={ariaDescribedBy} aria-invalid={invalid || undefined}
          aria-readonly={readOnly || undefined} disabled={!available}
          className={cn('w-full min-w-0 justify-start font-normal', !value && 'text-muted-foreground', triggerClassName)}
          onKeyDown={event => {
            if (!available || event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); requestOpen(true); }
          }}>
          <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">{display}</span>
          <span className="min-w-0 flex-1 overflow-hidden text-left">
            <PickerValueText parts={[{ type: 'time', value: display }]} identity={value} animate={animateValue} />
          </span>
          <ChevronDown aria-hidden="true" className={cn('size-3.5 text-muted-foreground transition-transform duration-[var(--zero-calendar-motion-spring)] ease-[var(--zero-calendar-ease-spring)] motion-reduce:transition-none', open && 'rotate-180')} />
        </Button>
      </PopoverTrigger>
    </div>
    <PopoverContent data-slot="time-picker-popover" align="start" collisionPadding={12}
      className="flex max-h-[min(20rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),10rem)] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-1"
      ref={popupMotion.ref} initial={false} animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={popupMotion.exit} transition={popupMotion.transition}
      onOpenAutoFocus={event => { event.preventDefault(); listRef.current?.focus({ preventScroll: true }); }}>
      <div ref={bindList} id={listId} role="listbox" tabIndex={0} aria-label={`${ariaLabel} options`}
        aria-activedescendant={`${controlId}-option-${activeIndex}`} onKeyDown={onListKey}
        data-slot="time-picker-list" className="relative min-h-0 max-h-64 flex-1 overflow-y-auto overscroll-contain outline-none">
        <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
        {virtual.getVirtualItems().map(item => {
          const index = item.index, option = options[index]!;
          return <Button key={option} type="button" variant="ghost" role="option" tabIndex={-1} animateIcon={false}
          ref={virtual.measureElement} data-index={index} aria-posinset={index + 1} aria-setsize={options.length}
          style={{ position: 'absolute', top: 0, left: 0, transform: `translateY(${item.start}px)` }}
          id={`${controlId}-option-${index}`} data-option-index={index} aria-selected={option === value}
          className={cn('w-full justify-between font-normal tabular-nums', activeIndex === index && 'bg-accent text-accent-foreground')}
          onPointerMove={event => { if (event.pointerType !== 'touch') setActive(index); }} onClick={() => choose(option)}>
          {formatTimePickerDisplay(option, format)}
          {option === value ? <Check className="size-3.5" aria-hidden="true" /> : null}
        </Button>;
        })}
        </div>
      </div>
      <div data-slot="time-picker-footer" className="mt-1 flex min-w-0 shrink-0 items-center justify-between gap-2 border-t border-border px-1 pt-1">
        {clearable ? <Button type="button" variant="ghost" size="sm" onClick={() => choose('')} disabled={!value}>Clear</Button> : <span />}
        <Button type="button" variant="ghost" size="sm" onClick={() => requestOpen(false)} aria-label="Close time picker">Close</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
