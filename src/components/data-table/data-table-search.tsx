/**
 * data-table-search.tsx
 *
 * Renders the compact, expanding search control used only by Zero data-table
 * toolbars. This component owns search presentation and keyboard interaction;
 * the parent table owns the filter value and row filtering behavior.
 */

'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';

import { Search } from '#zero/components/animate-ui/icons/search';
import { cn } from '#zero/lib/utils';

export interface DataTableSearchProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'defaultValue' | 'onChange' | 'size' | 'type' | 'value'
  > {
  /** Current table-wide search text. */
  value: string;
  /** Receives every search-text change, including clear and Escape actions. */
  onValueChange: (value: string) => void;
  /** Accessible name for the searchbox. */
  label?: string;
  /** Width of the resting search control in pixels. */
  collapsedWidth?: number;
  /** Width of the focused or populated input surface in pixels. */
  expandedWidth?: number;
  /** Reports focus-driven expansion changes. */
  onOpenChange?: (open: boolean) => void;
}

/** Declarative search presentation accepted by DataTable's `searchable` prop. */
export interface DataTableSearchOptions {
  placeholder?: string;
  ariaLabel?: string;
  collapsedWidth?: number;
  expandedWidth?: number;
  disabled?: boolean;
}

const SPRING_TRANSITION = {
  type: 'spring' as const,
  bounce: 0.18,
  duration: 0.38,
};

/**
 * Render Zero's table-scoped compact searchbox.
 *
 * The field expands on focus and remains expanded while it contains a value.
 * Escape clears a populated field first and collapses an empty field second.
 */
export const DataTableSearch = React.forwardRef<
  HTMLInputElement,
  DataTableSearchProps
>(function DataTableSearch(
  {
    value,
    onValueChange,
    label = 'Search table',
    placeholder = 'Search…',
    collapsedWidth = 116,
    expandedWidth = 208,
    onOpenChange,
    disabled,
    className,
    onFocus,
    onBlur,
    onKeyDown,
    ...inputProps
  },
  forwardedRef,
) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const reactId = React.useId();
  const filterId = `zero-table-search-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = React.useState(false);
  const open = focused || value.length > 0;
  const previousOpen = React.useRef(open);

  React.useImperativeHandle(forwardedRef, () => inputRef.current!, []);

  React.useEffect(() => {
    if (previousOpen.current === open) return;
    previousOpen.current = open;
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  const transition = reduceMotion ? { duration: 0 } : SPRING_TRANSITION;
  const inputOffset = open ? 38 : 0;
  const surfaceWidth = open ? expandedWidth : collapsedWidth;
  const overallWidth = surfaceWidth + inputOffset;
  const surfaceMaxWidth = open ? `calc(100% - ${inputOffset}px)` : '100%';

  return (
    <motion.div
      data-slot="data-table-search"
      data-open={open ? 'true' : 'false'}
      data-reduced-motion={reduceMotion ? 'true' : undefined}
      className={cn('relative h-8 shrink-0', className)}
      animate={{ width: overallWidth }}
      initial={false}
      transition={transition}
      style={{
        width: overallWidth,
        maxWidth: '100%',
      }}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      >
        <defs>
          <filter id={filterId} x="-30%" y="-75%" width="160%" height="250%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
              result="goo"
            />
          </filter>
        </defs>
      </svg>

      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0"
        animate={{ width: overallWidth }}
        initial={false}
        transition={transition}
        style={{ filter: `url(#${filterId})`, maxWidth: '100%' }}
      >
        <motion.span
          className="absolute inset-y-0 rounded-full bg-card"
          animate={{ left: inputOffset, width: surfaceWidth }}
          initial={false}
          transition={transition}
          style={{ maxWidth: surfaceMaxWidth }}
        />
        <motion.span
          className="absolute inset-y-0 left-0 aspect-square rounded-full bg-card"
          animate={{ opacity: open ? 1 : 0, scale: open ? 1 : 0.72 }}
          initial={false}
          transition={transition}
        />
      </motion.div>

      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-[5] aspect-square rounded-full bg-card shadow-sm ring-1 ring-border/50"
        animate={{ opacity: open ? 1 : 0, scale: open ? 1 : 0.72 }}
        initial={false}
        transition={transition}
      />

      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 z-10 flex aspect-square items-center justify-center text-card-foreground"
        animate={{ scale: open ? 1 : 0.92 }}
        initial={false}
        transition={transition}
      >
        <Search
          size={15}
          animate={open && !reduceMotion ? 'find' : false}
          aria-hidden="true"
          focusable="false"
        />
      </motion.div>

      <motion.div
        className={cn(
          'absolute inset-y-0 overflow-hidden rounded-full bg-card text-card-foreground shadow-sm ring-1 ring-border/50',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
        )}
        animate={{ left: inputOffset, width: surfaceWidth }}
        initial={false}
        transition={transition}
        style={{ maxWidth: surfaceMaxWidth }}
      >
        <input
          {...inputProps}
          ref={inputRef}
          type="search"
          role="searchbox"
          enterKeyHint="search"
          autoComplete="off"
          aria-label={label}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented) return;
            if (event.key === 'Enter') {
              event.preventDefault();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              if (value.length > 0) onValueChange('');
              else event.currentTarget.blur();
            }
          }}
          className={cn(
            'h-full w-full appearance-none bg-transparent py-1 text-sm outline-none',
            'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground',
            '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden',
            'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
            open ? 'pl-3 pr-8' : 'pl-8 pr-3',
          )}
        />

        {value.length > 0 && (
          <button
            type="button"
            aria-label="Clear search"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onValueChange('');
              inputRef.current?.focus();
            }}
            className={cn(
              'absolute right-1.5 top-1/2 z-20 flex size-5 -translate-y-1/2 items-center justify-center rounded-full',
              'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </motion.div>
    </motion.div>
  );
});

DataTableSearch.displayName = 'DataTableSearch';
