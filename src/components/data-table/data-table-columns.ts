/** One schema-to-column definition path for the displayed table and complete-source live matching. */
import type { ColumnDef, FilterFnOption } from '@tanstack/react-table';
import type { FieldMeta } from '../../schema/field-types';
import { decodeFieldValue } from '../../schema/field-codecs';
import type { Row } from '../../sync/types';
import type { UseDataTableOptions } from './use-data-table';

/** Preserve the same codecs, search eligibility, filters and overrides in every local row model. */
export function createDataTableColumns<T extends Row>(options: Pick<UseDataTableOptions<T>,
  'schema' | 'columns' | 'columnOverrides' | 'editable' | 'sortable' | 'searchableFields'>): ColumnDef<T, unknown>[] {
  const { schema, columnOverrides, editable = [] } = options;
  const fields = options.columns ?? schema.fieldNames.filter(name => schema.fields.get(name)?.tableVisible !== false);
  return fields.map(name => {
    const meta = schema.fields.get(name), override = columnOverrides?.[name], filterFn = schemaFilter<T>(meta);
    return {
      id: name,
      accessorFn: row => meta ? decodeFieldValue(meta, row[name]) : row[name],
      header: override?.header ?? meta?.label ?? name.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim(),
      ...(override?.cell ? { cell: context => override.cell!({ row: context.row.original, value: context.getValue(), columnId: name, fieldMeta: meta }) } : {}),
      enableSorting: options.sortable !== false && (override?.sortable ?? meta?.sortable !== false),
      enableColumnFilter: override?.filterable ?? meta?.filterable !== false,
      enableGlobalFilter: options.searchableFields ? options.searchableFields.includes(name) : undefined,
      ...(filterFn ? { filterFn } : {}),
      ...(override?.sortDescFirst !== undefined ? { sortDescFirst: override.sortDescFirst } : {}),
      ...(override?.sortingFn ? { sortingFn: override.sortingFn } : {}),
      size: override?.width ?? meta?.columnWidth,
      minSize: override?.minWidth,
      maxSize: override?.maxWidth,
      meta: {
        fieldMeta: meta, isEditable: override?.editable ?? editable.includes(name),
        flex: override?.flex, wrap: override?.wrap, truncate: override?.truncate,
        customCell: Boolean(override?.cell),
      },
    };
  });
}

function schemaFilter<T extends Row>(meta: FieldMeta | undefined): FilterFnOption<T> | undefined {
  switch (meta?.type) {
    case 'boolean': case 'date': case 'datetime': case 'enum': case 'number': case 'select': return 'equals';
    case 'combobox': return meta.multiple ? 'arrIncludes' : 'equals';
    case 'multiSelect': case 'tags': return 'arrIncludes';
    default: return undefined;
  }
}
