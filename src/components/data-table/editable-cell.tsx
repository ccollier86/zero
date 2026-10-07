'use client';

import * as React from 'react';
import { AlertCircle, LoaderCircle, RotateCcw } from 'lucide-react';
import type { FieldMeta } from '../../schema/field-types';
import { Checkbox } from '#zero/components/animate-ui/components/radix/checkbox';
import { Button } from '#zero/components/ui/button';
import { formatEditableCellValue } from './editable-cell-value';
import { EditableCellEditor } from './editable-cell-editor';
import {
  useEditableCellSave,
  type EditableCellSave,
} from './use-editable-cell-save';
import {
  useDataTableMutationRunner,
  type DataTableMutationRunner,
} from './use-data-table-mutation';

export interface EditableCellProps {
  value: unknown;
  /** Optional read presentation; editing and validation continue to use the actual typed value. */
  displayValue?: React.ReactNode;
  rowId: string;
  columnId: string;
  fieldMeta?: FieldMeta;
  isEditing: boolean;
  onStartEdit: () => void;
  onSave: EditableCellSave;
  /** Called after the write and its configured refresh are both accepted. */
  onAccepted?: () => void;
  onCancel: () => void;
  onTabNext?: () => void;
  mutationRunner?: DataTableMutationRunner;
  onRefresh?: () => void | Promise<void>;
  refreshOnSuccess?: boolean;
  mutationBoundaryKey?: string | number | null;
}

/** Schema-aware cell editor that closes or advances only after an accepted write. */
export function EditableCell(props: EditableCellProps) {
  if (props.mutationRunner) {
    return <EditableCellContent {...props} runner={props.mutationRunner} />;
  }
  return <EditableCellWithLocalRunner {...props} />;
}

function EditableCellWithLocalRunner(props: EditableCellProps) {
  const localRunner = useDataTableMutationRunner({
    boundaryKey: props.mutationBoundaryKey,
    refresh: props.onRefresh,
  });
  return <EditableCellContent {...props} runner={localRunner} />;
}

function EditableCellContent({
  value,
  displayValue,
  rowId,
  columnId,
  fieldMeta,
  isEditing,
  onStartEdit,
  onSave,
  onAccepted,
  onCancel,
  onTabNext,
  onRefresh,
  refreshOnSuccess,
  runner,
}: EditableCellProps & { runner: DataTableMutationRunner }) {
  const lifecycle = useEditableCellSave({
    rowId,
    columnId,
    onSave,
    onAccepted,
    onTabNext,
    onRefresh,
    refreshOnSuccess,
    runner,
  });
  const wasEditing = React.useRef(isEditing);

  React.useEffect(() => {
    if (wasEditing.current && !isEditing) lifecycle.clearError();
    wasEditing.current = isEditing;
  }, [isEditing, lifecycle.clearError]);

  const cancel = React.useCallback(() => {
    if (lifecycle.pending) return;
    lifecycle.clearError();
    onCancel();
  }, [lifecycle, onCancel]);

  if ((fieldMeta?.type ?? 'text') === 'boolean') {
    return (
      <BooleanEditableCell
        value={value}
        pending={lifecycle.pending}
        error={lifecycle.error}
        onToggle={(next) => lifecycle.save(next)}
        onRetry={lifecycle.retry}
      />
    );
  }

  if (isEditing) {
    return (
      <EditableCellEditor
        value={value}
        fieldMeta={fieldMeta}
        pending={lifecycle.pending}
        error={lifecycle.error}
        onCommit={lifecycle.save}
        onCancel={cancel}
        onRetry={lifecycle.retry}
        onDraftChange={lifecycle.clearError}
      />
    );
  }

  return (
    <div
      data-slot="editable-cell-display"
      className="min-h-[1.5rem] cursor-pointer rounded px-1 py-0.5 transition-colors hover:bg-accent/50"
      onClick={() => {
        lifecycle.clearError();
        onStartEdit();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        lifecycle.clearError();
        onStartEdit();
      }}
    >
      {displayValue ?? formatEditableCellValue(value, fieldMeta)}
    </div>
  );
}

function BooleanEditableCell({
  value,
  pending,
  error,
  onToggle,
  onRetry,
}: {
  value: unknown;
  pending: boolean;
  error: string | null;
  onToggle(value: boolean): Promise<boolean>;
  onRetry(): Promise<boolean>;
}) {
  return (
    <div
      data-slot="editable-boolean-cell"
      data-save-state={pending ? 'pending' : error ? 'error' : 'idle'}
      className="flex min-w-0 flex-wrap items-center justify-center gap-1"
      aria-busy={pending || undefined}
    >
      <Checkbox
        checked={value as boolean}
        disabled={pending}
        aria-invalid={error ? true : undefined}
        onCheckedChange={(checked) => { void onToggle(checked === true); }}
      />
      {pending && (
        <span role="status" className="text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
          <span className="sr-only">Saving…</span>
        </span>
      )}
      {error && !pending && (
        <span role="alert" className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3" aria-hidden="true" />
          <span className="sr-only">{error}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-destructive hover:text-destructive"
            title="Retry save"
            onClick={() => { void onRetry(); }}
          >
            <RotateCcw className="size-3" />
            <span className="sr-only">Retry save</span>
          </Button>
        </span>
      )}
    </div>
  );
}

export type { EditableCellSave } from './use-editable-cell-save';
