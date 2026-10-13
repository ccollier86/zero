'use client';

/** Standard shared decision frame; the supplied authorized action must acknowledge before closing. */
import { ControlledModal } from '../../modals/modal-controlled';
import { dataStudioDialogErrorMessage } from './data-studio-dialog-field';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from '../../frontend/client/observability';

export interface DataStudioConfirmDialogProps {
  readonly open: boolean;
  readonly trigger?: Element | null;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly busy?: boolean;
  readonly destructive?: boolean;
  readonly operationKey?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => Promise<unknown>;
}

export function DataStudioConfirmDialog(props: DataStudioConfirmDialogProps) {
  return <ControlledModal open={props.open} identityKey={props.operationKey ?? props.title + props.description}
    busy={props.busy} onOpenChange={props.onOpenChange} descriptor={{
      title: props.title, description: props.description, trigger: props.trigger, size: 'sm', role: 'alertdialog',
      tone: props.destructive ? 'danger' : 'default', initialFocus: props.destructive ? 'cancel' : 'primary', guard: false,
      actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel', disabled: props.busy },
        { id: 'confirm', label: props.confirmLabel, variant: props.destructive ? 'danger' : 'primary', disabled: props.busy,
          onClick: async context => {
            try { const receipt = await props.onConfirm(); return context.signal.aborted ? false : receipt ?? true; }
            catch (cause) {
              if (!context.signal.aborted) {
                context.setError(dataStudioDialogErrorMessage(cause));
                emitFrontendCode(OBS_CODES.FRONTEND_DATA_STUDIO_OPERATION_FAILED, { metadata: { surface: 'confirmation', stage: 'confirm' } });
              }
              return false;
            }
          } }],
    }} />;
}
