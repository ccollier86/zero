'use client';

/** Three-way leave decision on Zero's shared owned modal shell; the save controller owns persistence/navigation. */
import { ControlledModal } from '../../modals/modal-controlled';
import { useOverlayScope } from '../overlays/overlay-scope';
import type { UseFormSaveReturn } from '../../hooks/use-form-save';

export interface UnsavedChangesDialogProps {
  readonly controller: UseFormSaveReturn;
  readonly title?: string;
  readonly description?: string;
}

/** A failed save or newer draft keeps the dialog open; closing chooses Stay, never Discard. */
export function UnsavedChangesDialog({ controller, title = 'Save your changes?',
  description = 'You have unsaved changes. Save them, discard them, or stay and keep editing.' }: UnsavedChangesDialogProps) {
  const owner = useOverlayScope();
  return <ControlledModal open={controller.confirmationOpen} busy={controller.isSaving} error={controller.error}
    onOpenChange={open => {
    if (!open && !controller.isSaving) void controller.chooseLeave('stay');
  }} descriptor={{ title, description, role: 'alertdialog', size: 'sm', guard: false, initialFocus: 'cancel',
    parentId: owner?.id,
    body: controller.isSaving ? <p role="status">Saving your changes…</p> : undefined,
    actions: [
      { id: 'stay', label: 'Stay', role: 'cancel', variant: 'ghost' },
      { id: 'discard', label: 'Discard changes', variant: 'secondary', closes: false,
        onClick: async () => { await controller.chooseLeave('discard'); return false; } },
      { id: 'save', label: 'Save and leave', variant: 'primary', closes: false,
        onClick: async () => { await controller.chooseLeave('save'); return false; } },
    ],
  }} />;
}
