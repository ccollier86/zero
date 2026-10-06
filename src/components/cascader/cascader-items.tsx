'use client';

/** Render one navigable level or path-annotated global results with Zero's list and checkbox primitives. */
import * as React from 'react';
import { Check, ChevronRight, LoaderCircle } from 'lucide-react';
import { CommandItem, CommandList } from '../ui/command';
import { Checkbox } from '../ui/checkbox';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { useCascaderView } from './cascader-context';
import type { CascaderNode } from './cascader.types';

/** Only the options scroll; the footer remains its sibling inside CascaderPanel. */
export function CascaderList({ className, ...props }: React.ComponentProps<typeof CommandList>) {
  const view = useCascaderView();
  return <CommandList data-slot="cascader-list" aria-busy={view.loading}
    className={cn('min-h-0 max-h-72 flex-1 overscroll-contain p-1', className)} {...props} />;
}

/** Default typed rows with branch navigation separate from capped leaf selection. */
export function CascaderItems<T = unknown>({ renderLabel }: { renderLabel?: (node: CascaderNode<T>) => React.ReactNode }) {
  const view = useCascaderView();
  const searching = !!view.query.trim();
  return <>
    {view.entries.map((entry) => {
      const selected = view.values.includes(entry.node.value);
      const atCap = view.multiple && view.max !== undefined && view.values.length >= view.max && !selected;
      const blocked = view.disabled || entry.disabled || (!entry.hasChildren && (view.readOnly || atCap));
      const pending = view.loading && view.loadingKey === entry.node.value;
      return <CommandItem key={entry.node.value} value={entry.node.value} disabled={blocked}
        data-slot="cascader-item" data-cascader-value={entry.node.value} data-checked={selected}
        aria-label={entry.pathLabel} aria-describedby={atCap && !entry.hasChildren ? `${view.id}-limit` : undefined}
        className="min-h-10 gap-2.5 rounded-lg px-2.5 py-2"
        onSelect={() => entry.hasChildren ? void view.navigate(entry) : view.toggle(entry)}>
        {view.multiple && !entry.hasChildren && <Checkbox checked={selected} tabIndex={-1}
          aria-label={`Select ${entry.pathLabel}`} disabled={blocked}
          onClick={(event) => event.stopPropagation()} onCheckedChange={() => view.toggle(entry)} />}
        {entry.node.icon && <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">{entry.node.icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{renderLabel?.(entry.node as CascaderNode<T>) ?? entry.node.label}</span>
          {(searching || entry.node.description) && <span className="block truncate text-xs text-muted-foreground">
            {searching ? entry.pathLabel : entry.node.description}
          </span>}
        </span>
        {pending ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Loading branch" />
          : entry.hasChildren ? <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          : !view.multiple && selected ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
      </CommandItem>;
    })}
    {view.error && <div role="alert" className="m-1 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
      <p>{view.error}</p><Button type="button" size="xs" variant="ghost" onClick={view.retry} disabled={view.loading}>Retry</Button>
    </div>}
    {!view.entries.length && !view.error && <div className="flex min-h-28 items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
      {view.loading && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
      {view.loading ? 'Loading options…' : searching ? 'No matching attributes.' : 'No attributes in this level.'}
    </div>}
  </>;
}
