'use client';

/** Await the existing domain action before accepting Zero's shared owned decision shell. */
import { ControlledModal } from '../../modals/modal-controlled';
import type { IntegrationSettingsAction, IntegrationSettingsItem } from './integration-settings-list.types';

/** Pending work cannot accidentally dismiss its confirmation or dispatch twice. */
export function IntegrationSettingsConfirmationDialog({ item, action, pending, error, onClose, onConfirm, onCloseAutoFocus }: {
  item: IntegrationSettingsItem;
  action: IntegrationSettingsAction | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
  onCloseAutoFocus: (event: Event) => void;
}) {
  if (!action) return null;
  return <ControlledModal<boolean> open busy={pending} error={error} identityKey={`${item.id}:${action.id}`}
    onOpenChange={open => { if (!open) onClose(); }} descriptor={{
      title: action.confirmation?.title ?? `${action.label}?`,
      description: action.confirmation?.description ?? `Confirm ${action.label.toLocaleLowerCase()} for ${item.title}.`,
      role: 'alertdialog', size: 'sm', guard: false, tone: action.destructive ? 'danger' : 'default', initialFocus: 'cancel',
      onCloseAutoFocus, body: pending ? <p role="status">Working…</p> : undefined,
      actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel' },
        { id: 'confirm', label: pending ? 'Working…' : action.confirmation?.confirmLabel ?? action.label, variant: action.destructive ? 'danger' : 'primary',
          onClick: async context => { const accepted = await onConfirm(); return context.signal.aborted ? false : accepted; } }],
    }} />;
}
