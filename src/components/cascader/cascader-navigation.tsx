'use client';

/** Search, breadcrumb and selected-path presentation; delegates navigation to the controller. */
import * as React from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { CommandInput } from '../ui/command';
import { cn } from '../../lib/utils';
import { useCascaderView } from './cascader-context';

/** Global path search; arrow keys drill/back without stealing text-caret movement. */
export function CascaderInput({ placeholder = 'Search all attributes…', onKeyDown, ...props }: React.ComponentProps<typeof CommandInput>) {
  const view = useCascaderView();
  return <CommandInput aria-label={`Search ${view.label}`} placeholder={placeholder}
    value={view.query} onValueChange={view.setQuery} disabled={view.disabled}
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      const input = event.currentTarget;
      const highlighted = input.closest('[cmdk-root]')?.querySelector('[cmdk-item][data-selected="true"]');
      const value = highlighted?.getAttribute('data-cascader-value');
      const entry = view.entries.find((item) => item.node.value === value);
      if (event.key === 'ArrowRight' && input.selectionStart === input.value.length && input.selectionEnd === input.value.length && entry?.hasChildren) {
        event.preventDefault(); void view.navigate(entry);
      } else if ((event.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0 || event.key === 'Backspace' && !input.value) && view.path.length) {
        event.preventDefault(); view.goToDepth(view.path.length - 1);
      }
    }} {...props} />;
}

/** Compact root/back controls keep the current branch understandable after every drill. */
export function CascaderBreadcrumb({ className, rootLabel = 'All attributes', ...props }: React.ComponentProps<'nav'> & { rootLabel?: string }) {
  const view = useCascaderView();
  return <nav aria-label="Attribute path" data-slot="cascader-breadcrumb"
    className={cn('flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5', className)} {...props}>
    {view.path.length > 0 && <Button type="button" variant="ghost" size="icon-xs" aria-label="Back one level"
      onClick={() => view.goToDepth(view.path.length - 1)}><ArrowLeft aria-hidden="true" /></Button>}
    <Button type="button" variant="ghost" size="xs" onClick={() => view.goToDepth(0)}>{rootLabel}</Button>
    {view.path.map((value, depth) => <React.Fragment key={value}>
      <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Button type="button" variant="ghost" size="xs" aria-current={depth === view.path.length - 1 ? 'location' : undefined}
        onClick={() => view.goToDepth(depth + 1)}>{view.index.byValue.get(value)?.node.label ?? value}</Button>
    </React.Fragment>)}
  </nav>;
}

/** Format one full path or a compact multi-selection summary without assuming unique labels. */
export function CascaderValue({ placeholder = 'Select attributes', className, ...props }: React.ComponentProps<'span'> & { placeholder?: string }) {
  const view = useCascaderView();
  const text = view.selections.length === 0 ? placeholder : view.selections.length === 1
    ? view.selections[0]!.pathLabel : `${view.selections.length} selected`;
  return <span data-slot="cascader-value" title={view.selections.map((item) => item.pathLabel).join(', ')}
    className={cn('min-w-0 truncate text-start', !view.selections.length && 'text-muted-foreground', className)} {...props}>{text}</span>;
}
