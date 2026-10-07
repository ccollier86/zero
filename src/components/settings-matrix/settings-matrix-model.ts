/** Derive matrix cell presentation and capability hints; no mutation or persistence. */

import type { SettingsMatrixColumn, SettingsMatrixProps, SettingsMatrixRow } from './settings-matrix-types';

export interface SettingsMatrixCell {
  readonly key: string;
  readonly rowId: string;
  readonly columnId: string;
  readonly checked: boolean | null;
  readonly readOnly: boolean;
  readonly disabled: boolean;
  readonly reason: string | null;
}

/** Reject ambiguous descriptors rather than sharing controls across duplicate IDs. */
export function validateSettingsMatrixDescriptors(props: Pick<SettingsMatrixProps, 'columns' | 'rows'>): void {
  if (props.columns.length < 1 || props.columns.length > 3) {
    throw new Error('SettingsMatrix requires one to three choice columns.');
  }
  for (const descriptors of [props.columns, props.rows]) {
    const ids = new Set<string>();
    for (const descriptor of descriptors) {
      if (typeof descriptor.id !== 'string' || !descriptor.id.trim()
        || typeof descriptor.label !== 'string' || !descriptor.label.trim()
        || ids.has(descriptor.id)) {
        throw new Error('SettingsMatrix descriptors require unique nonempty IDs and labels.');
      }
      ids.add(descriptor.id);
    }
  }
}

/** Stable, collision-free cell key for callback ownership. */
export function settingsMatrixCellKey(rowId: string, columnId: string): string {
  return JSON.stringify([rowId, columnId]);
}

/** Omitted choices are unavailable, not silently interpreted as unchecked. */
export function readSettingsMatrixCell(
  props: SettingsMatrixProps,
  row: SettingsMatrixRow,
  column: SettingsMatrixColumn,
): SettingsMatrixCell {
  const rowValue = Object.hasOwn(props.value, row.id) ? props.value[row.id] : undefined;
  const value = rowValue && Object.hasOwn(rowValue, column.id) ? rowValue[column.id] : undefined;
  const capability = row.cells && Object.hasOwn(row.cells, column.id) ? row.cells[column.id] : undefined;
  const checked = typeof value === 'boolean' ? value : null;
  const readOnly = Boolean(props.readOnly || row.readOnly || capability?.readOnly || !props.onChange);
  const disabled = Boolean(props.disabled || row.disabled || capability?.disabled);
  const reason = checked === null ? 'Not available'
    : props.disabled ? props.disabledReason ?? 'This setting is unavailable.'
      : row.disabled ? row.disabledReason ?? 'This setting is unavailable.'
        : capability?.disabled ? capability.disabledReason ?? 'This choice is unavailable.'
          : readOnly ? capability?.disabledReason ?? row.disabledReason ?? props.disabledReason ?? 'Read-only setting'
            : null;
  return { key: settingsMatrixCellKey(row.id, column.id), rowId: row.id, columnId: column.id,
    checked, readOnly, disabled, reason };
}

/** Available editable choices exclude disabled, read-only and omitted cells. */
export function settingsMatrixCellIsEditable(cell: SettingsMatrixCell): boolean {
  return cell.checked !== null && !cell.readOnly && !cell.disabled;
}
