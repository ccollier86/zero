'use client';

/** Optional external path chips, rendered from the same selection state rather than a second store. */
import * as React from 'react';
import { X } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { useCascaderSelection } from './cascader-context';

/** Place inside Cascader but outside CascaderContent; full paths distinguish repeated labels. */
export function CascaderSelectionChips({ className, label = 'Selected values', emptyLabel, ...props }:
  React.ComponentProps<'div'> & { label?: string; emptyLabel?: string }) {
  const selection = useCascaderSelection();
  return <div role="group" aria-label={label} data-slot="cascader-selection-chips"
    className={cn('flex min-w-0 flex-wrap gap-1.5', className)} {...props}>
    {selection.items.length === 0 && emptyLabel && <span className="text-xs text-muted-foreground">{emptyLabel}</span>}
    {selection.items.map((item) => <Badge key={item.value} variant="outline" data-slot="cascader-selection-chip"
      className="max-w-full gap-1 rounded-lg bg-muted/40 py-1 pl-2.5 pr-1 font-normal" title={item.pathLabel}>
      <span className="min-w-0 truncate">{item.pathLabel}</span>
      <Button type="button" size="icon-xs" variant="ghost" aria-label={`Remove ${item.pathLabel}`}
        disabled={selection.disabled} className="size-5 shrink-0 rounded-md"
        onClick={() => selection.remove(item.value)}><X className="size-3" aria-hidden="true" /></Button>
    </Badge>)}
  </div>;
}
