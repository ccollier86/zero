'use client';

/** Three-way leave confirmation using Zero AlertDialog; persistence/navigation remain controlled. */
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter } from '../animate-ui/components/radix/alert-dialog';
import { Button } from '../ui/button';
import type { UseFormSaveReturn } from '../../hooks/use-form-save';

export interface UnsavedChangesDialogProps {
  readonly controller: UseFormSaveReturn;
  readonly title?: string;
  readonly description?: string;
}

/** A failed save or newer draft keeps the dialog open; closing chooses Stay, never Discard. */
export function UnsavedChangesDialog({ controller, title = 'Save your changes?',
  description = 'You have unsaved changes. Save them, discard them, or stay and keep editing.' }: UnsavedChangesDialogProps) {
  return <AlertDialog open={controller.confirmationOpen} onOpenChange={open => {
    if (!open && !controller.isSaving) void controller.chooseLeave('stay');
  }}>
    <AlertDialogContent className="form-save-dialog" onEscapeKeyDown={event => { if (controller.isSaving) event.preventDefault(); }}>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      {controller.error && <p role="alert" className="form-save-bar__error">{controller.error}</p>}
      {controller.isSaving && <p role="status">Saving your changes…</p>}
      <AlertDialogFooter>
        <Button type="button" variant="ghost" autoFocus disabled={controller.isSaving}
          onClick={() => { void controller.chooseLeave('stay'); }}>Stay</Button>
        <Button type="button" variant="outline" disabled={controller.isSaving}
          onClick={() => { void controller.chooseLeave('discard'); }}>Discard changes</Button>
        <Button type="button" disabled={controller.isSaving}
          onClick={() => { void controller.chooseLeave('save'); }}>{controller.isSaving ? 'Saving…' : 'Save and leave'}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
