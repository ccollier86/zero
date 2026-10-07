'use client';

/** Await destructive actions inside Zero's existing focus-managed AlertDialog. */
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '../animate-ui/components/radix/alert-dialog';
import { buttonVariants } from '../ui/button';
import type { IntegrationSettingsAction, IntegrationSettingsItem } from './integration-settings-list.types';

/** Pending work cannot accidentally dismiss its confirmation or dispatch twice. */
export function IntegrationSettingsConfirmationDialog({ item, action, pending, error, onClose, onConfirm, onCloseAutoFocus }: {
  item: IntegrationSettingsItem;
  action: IntegrationSettingsAction | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return <AlertDialog open={Boolean(action)} onOpenChange={open => { if (!open && !pending) onClose(); }}>
    {action && <AlertDialogContent className="integration-settings-list__confirmation"
      onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}
      onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle>{action.confirmation?.title ?? `${action.label}?`}</AlertDialogTitle>
        <AlertDialogDescription>{action.confirmation?.description
          ?? `Confirm ${action.label.toLocaleLowerCase()} for ${item.title}.`}</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="integration-settings-list__error">{error}</p>}
      {pending && <p role="status" className="integration-settings-list__reason">Working…</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
        <AlertDialogAction disabled={pending} aria-busy={pending || undefined}
          className={buttonVariants({ variant: action.destructive ? 'destructive' : 'default' })}
          onClick={event => { event.preventDefault(); onConfirm(); }}>
          {pending ? 'Working…' : action.confirmation?.confirmLabel ?? action.label}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>}
  </AlertDialog>;
}
