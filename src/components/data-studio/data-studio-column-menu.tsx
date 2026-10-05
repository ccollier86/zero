'use client';

/** Compact column actions share one menu for the visible trigger and header right-click. */
import * as React from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger } from '../animate-ui/components/radix/dropdown-menu';

export function DataStudioColumnMenu({ label, open, onOpenChange, editable, sortable,
  canMoveLeft, canMoveRight, canRemove, pending, onSort, onMove, onIntent }: {
  label: string; open: boolean; onOpenChange: (open: boolean) => void;
  editable: boolean; sortable: boolean; canMoveLeft: boolean; canMoveRight: boolean;
  canRemove: boolean; pending: boolean;
  onSort: (direction: 'asc' | 'desc') => void;
  onMove: (direction: 'left' | 'right') => void;
  onIntent: (intent: 'edit' | 'remove') => void;
}) {
  const intent = React.useRef<(() => void) | null>(null);
  const [closing, setClosing] = React.useState(false);
  return <DropdownMenu open={open} onOpenChange={(next) => {
    if (next && closing) return;
    if (!next) setClosing(true);
    onOpenChange(next);
  }} modal={false}>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={`${label} column options`} disabled={pending || closing}
        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <MoreVertical className="size-3.5" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-48" onCloseAutoFocus={(event) => {
      setClosing(false);
      if (!intent.current) return;
      event.preventDefault();
      const next = intent.current; intent.current = null;
      // The menu's exit/focus lifecycle must finish before a new focus scope opens.
      next();
    }}>
      <DropdownMenuItem disabled={!editable || pending} onSelect={() => { intent.current = () => onIntent('edit'); }}>
        <Pencil /> Edit column
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!sortable || pending} onSelect={() => onSort('asc')}><ArrowUp /> Sort ascending</DropdownMenuItem>
      <DropdownMenuItem disabled={!sortable || pending} onSelect={() => onSort('desc')}><ArrowDown /> Sort descending</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!editable || !canMoveLeft || pending} onSelect={() => onMove('left')}><ArrowLeft /> Move left</DropdownMenuItem>
      <DropdownMenuItem disabled={!editable || !canMoveRight || pending} onSelect={() => onMove('right')}><ArrowRight /> Move right</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" disabled={!editable || !canRemove || pending}
        onSelect={() => { intent.current = () => onIntent('remove'); }}><Trash2 /> Remove column</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
