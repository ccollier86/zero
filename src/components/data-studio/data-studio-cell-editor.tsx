'use client';

/** Anchored local-draft shell. Cell mutation/revision ownership remains with InlineCell. */
import * as React from 'react';
import { LoaderCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../animate-ui/components/radix/popover';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

export function DataStudioCellEditor({
  children, content, open, label, description, disabled, pending, dirty, error,
  className, onOpenChange, onApply, onCancel,
}: {
  readonly children: React.ReactElement;
  readonly content: React.ReactNode;
  readonly open: boolean;
  readonly label: string;
  readonly description?: string;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly dirty: boolean;
  readonly error: string | null;
  readonly className?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}) {
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  React.useEffect(() => { if (!open) setConfirmDiscard(false); }, [open]);
  function requestClose() {
    if (pending) return;
    if (dirty) { setConfirmDiscard(true); return; }
    onOpenChange(false);
  }
  function dismiss(event: Event) {
    if (pending || dirty) event.preventDefault();
    if (!pending && dirty) setConfirmDiscard(true);
  }
  return <Popover open={open} onOpenChange={next => next ? onOpenChange(true) : requestClose()}>
    <PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent align="start" collisionPadding={12}
      aria-label={`Edit ${label}`} data-slot="data-studio-cell-editor"
      className={cn('flex max-h-[min(36rem,calc(100dvh-1.5rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden p-0', className)}
      onClick={event => event.stopPropagation()}
      onCloseAutoFocus={event => event.preventDefault()}
      onEscapeKeyDown={dismiss} onInteractOutside={dismiss}>
      <div className="shrink-0 border-b border-border/60 px-3 py-2.5">
        <p className="truncate text-sm font-medium">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain p-3">{content}</div>
      <div className="shrink-0 space-y-2 border-t border-border/60 px-3 py-2.5">
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {confirmDiscard ? <div role="alert" className="space-y-2">
          <p className="text-xs text-muted-foreground">Keep editing, or discard your unsaved changes.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCancel}>Discard changes</Button>
          </div>
        </div> : <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
          <Button type="button" size="sm" disabled={disabled || pending} onClick={onApply} aria-busy={pending || undefined}>
            {pending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
            {pending ? 'Saving…' : 'Apply'}
          </Button>
        </div>}
      </div>
    </PopoverContent>
  </Popover>;
}
