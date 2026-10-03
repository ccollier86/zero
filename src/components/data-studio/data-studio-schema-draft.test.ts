import { describe, expect, test } from 'bun:test';
import type { DataStudioTable } from '../../frontend/client/data-studio-client';
import {
  buildDataStudioSchema,
  dataStudioColumnLabelPatch,
  dataStudioEditableColumns,
  moveDataStudioEditableColumn,
  newDataStudioEditableColumn,
} from './data-studio-schema-draft';

const table: DataStudioTable = {
  tableId: 'table-1',
  key: 'contacts',
  name: 'Contacts',
  description: null,
  status: 'active',
  schema: {
    version: 1,
    columns: [{
      columnId: 'column_name',
      key: 'display_name',
      label: 'Display name',
      description: 'Shown to teammates',
      type: 'text',
      required: false,
      defaultValue: 'Unknown',
    }],
  },
  schemaRevision: 1,
  revision: 1,
  rowCount: 0,
  createdAt: 1,
  updatedAt: 1,
};

describe('Data Studio schema drafts', () => {
  test('never silently renames a persisted API key from a label edit', () => {
    const persisted = dataStudioEditableColumns(table)[0]!;
    expect(dataStudioColumnLabelPatch(persisted, 'Preferred name')).toEqual({
      label: 'Preferred name',
    });

    const created = newDataStudioEditableColumn(0);
    expect(dataStudioColumnLabelPatch(created, 'Preferred name')).toEqual({
      label: 'Preferred name',
      key: 'preferred_name',
    });
  });

  test('authors descriptions and type-aware defaults in presentation order', () => {
    const name = dataStudioEditableColumns(table)[0]!;
    const score = {
      ...newDataStudioEditableColumn(1),
      columnId: 'column_score',
      key: 'score',
      label: 'Score',
      description: 'Finite ranking',
      type: 'number' as const,
      defaultMode: 'value' as const,
      defaultDraft: '4.5',
    };
    const active = {
      ...newDataStudioEditableColumn(2),
      columnId: 'column_active',
      key: 'active',
      label: 'Active',
      type: 'boolean' as const,
      defaultMode: 'value' as const,
      defaultDraft: 'true',
    };
    const ordered = moveDataStudioEditableColumn([name, score, active], 2, -1);

    expect(buildDataStudioSchema(ordered).columns).toEqual([
      expect.objectContaining({
        columnId: 'column_name',
        key: 'display_name',
        description: 'Shown to teammates',
        defaultValue: 'Unknown',
      }),
      expect.objectContaining({
        columnId: 'column_active',
        defaultValue: true,
      }),
      expect.objectContaining({
        columnId: 'column_score',
        description: 'Finite ranking',
        defaultValue: 4.5,
      }),
    ]);
  });

  test('rejects invalid and required-null defaults before issuing a mutation', () => {
    const number = {
      ...newDataStudioEditableColumn(0),
      type: 'number' as const,
      defaultMode: 'value' as const,
      defaultDraft: 'Infinity',
    };
    const requiredNull = {
      ...newDataStudioEditableColumn(0),
      required: true,
      defaultMode: 'null' as const,
    };

    expect(() => buildDataStudioSchema([number])).toThrow(/finite number/u);
    expect(() => buildDataStudioSchema([requiredNull])).toThrow(/cannot store null/u);
  });
});
