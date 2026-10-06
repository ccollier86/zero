import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  DataStudioRow,
  DataStudioTable,
} from '../../frontend/client/data-studio-client';
import { DataStudioGrid } from './data-studio-grid';
import { DataStudioDefaultEditor } from './data-studio-default-editor';
import { DataStudioFilterControl } from './data-studio-filter-control';
import { DataStudioInspector } from './data-studio-inspector';
import { resolveDataStudioCellKeyAction } from './data-studio-inline-cell';
import { DataStudioToolbar } from './data-studio-toolbar';
import {
  dataStudioValueDraft,
  dataStudioCodeExample,
  parseDataStudioValueDraft,
} from './data-studio-value';

const table: DataStudioTable = {
  tableId: 'table-1',
  key: 'contacts',
  name: 'Contacts',
  description: 'People known to this organization.',
  status: 'active',
  schema: {
    version: 1,
    columns: [
      { columnId: 'name', key: 'name', label: 'Name', type: 'text', required: true },
      { columnId: 'score', key: 'score', label: 'Score', type: 'number', required: false },
    ],
  },
  schemaRevision: 2,
  revision: 3,
  rowCount: 1,
  createdAt: 1,
  updatedAt: 2,
};

const row: DataStudioRow = {
  rowId: 'row-1',
  tableId: table.tableId,
  schemaRevision: 2,
  revision: 4,
  values: { name: 'Ada', score: 99 },
  createdAt: 1,
  updatedAt: 2,
};

describe('Data Studio inline grid', () => {
  test('an empty schema grid has valid spans when optional schema actions are omitted', () => {
    const markup = renderToStaticMarkup(<DataStudioGrid table={table} rows={[]}
      selectedRowId={null} editable={false} onSelectRow={() => undefined}
      onCommit={async () => undefined} onReload={async () => undefined} />);
    expect(markup).toContain('colSpan="2"');
    expect(markup).not.toContain('NaN');
    expect(markup).toContain('Name');
    expect(markup).toContain('Score');
  });

  test('keeps logical values inside fixed, editable table cells', () => {
    const markup = renderToStaticMarkup(
      <DataStudioGrid
        table={table}
        rows={[row]}
        selectedRowId={row.rowId}
        editable
        onSelectRow={() => undefined}
        onCommit={async () => undefined}
        onReload={async () => undefined}
      />,
    );

    expect(markup).toContain('data-slot="data-studio-grid"');
    expect(markup).toContain('table-fixed');
    expect(markup).toContain('data-slot="data-studio-inline-cell"');
    expect(markup).toContain('aria-label="Edit Name, current value Ada"');
    expect(markup).toContain('min-h-7 min-w-0');
    expect(markup).not.toContain('group/input');
  });

  test('maps Enter, Tab, Shift+Tab, and Escape to the hard editing contract', () => {
    expect(resolveDataStudioCellKeyAction('Enter')).toEqual({ type: 'save' });
    expect(resolveDataStudioCellKeyAction('Tab')).toEqual({
      type: 'save-and-move', direction: 1,
    });
    expect(resolveDataStudioCellKeyAction('Tab', true)).toEqual({
      type: 'save-and-move', direction: -1,
    });
    expect(resolveDataStudioCellKeyAction('Escape')).toEqual({ type: 'cancel' });
    expect(resolveDataStudioCellKeyAction('Enter', false, true)).toBeNull();
  });

  test('parses typed drafts instead of sending decorated input strings', () => {
    expect(parseDataStudioValueDraft('42.5', table.schema.columns[1]!)).toBe(42.5);
    expect(parseDataStudioValueDraft('', table.schema.columns[1]!)).toBeNull();
    expect(() => parseDataStudioValueDraft('Infinity', table.schema.columns[1]!)).toThrow();
    const datetimeColumn = {
      columnId: 'meeting_at',
      key: 'meeting_at',
      label: 'Meeting at',
      type: 'datetime' as const,
      required: true,
    };
    const timestamp = '2026-02-03T17:45:37.123Z';
    const draft = dataStudioValueDraft(timestamp, datetimeColumn);
    expect(draft.endsWith(':37.123')).toBe(true);
    expect(parseDataStudioValueDraft(draft, datetimeColumn)).toBe(timestamp);
  });

  test('admits precise datetime defaults without native minute-step rejection', () => {
    const markup = renderToStaticMarkup(
      <DataStudioDefaultEditor
        column={{
          columnId: 'meeting_at',
          key: 'meeting_at',
          label: 'Meeting at',
          type: 'datetime',
          required: false,
          description: '',
          defaultMode: 'value',
          defaultDraft: '2026-02-03T17:45:37.123',
          persisted: true,
        }}
        disabled={false}
        onChange={() => undefined}
      />,
    );
    expect(markup).not.toContain('type="datetime-local"');
    expect(markup).toContain('data-slot="date-picker"');
    expect(markup).toContain('data-slot="time-picker"');
    expect(markup).toContain('aria-label="Meeting at default value seconds"');
    expect(markup).toContain('value="37.123"');

    const numberMarkup = renderToStaticMarkup(
      <DataStudioDefaultEditor
        column={{
          columnId: 'score',
          key: 'score',
          label: 'Score',
          type: 'number',
          required: false,
          description: '',
          defaultMode: 'value',
          defaultDraft: '42.5',
          persisted: true,
        }}
        disabled={false}
        onChange={() => undefined}
      />,
    );
    // Text + decimal keyboard preserves an invalid local draft for validation;
    // native number inputs silently replace incompatible drafts with an empty value.
    expect(numberMarkup).toContain('type="text"');
    expect(numberMarkup).toContain('inputMode="decimal"');
    expect(numberMarkup).toContain('step="any"');
    expect(numberMarkup).toContain('value="42.5"');
  });
});

describe('Data Studio control plane presentation', () => {
  test('renders compact catalog/search/filter controls from capabilities', () => {
    const readOnly = renderToStaticMarkup(
      <DataStudioToolbar
        tables={[table]}
        selectedTableId={table.tableId}
        tableStatus="active"
        search="Ada"
        loadedCount={1}
        totalRows={1}
        canManage={false}
        onTableChange={() => undefined}
        onStatusChange={() => undefined}
        onSearchChange={() => undefined}
        onCreateTable={() => undefined}
        onRefresh={() => undefined}
      />,
    );
    expect(readOnly).toContain('aria-label="Logical table"');
    expect(readOnly).toContain('aria-label="Search records"');
    expect(readOnly).toContain('aria-label="Table status filter"');
    expect(readOnly).not.toContain('New table');
  });

  test('exposes active server row filters as a first-class compact control', () => {
    const markup = renderToStaticMarkup(
      <DataStudioFilterControl
        columns={table.schema.columns}
        filters={[{ columnKey: 'name', operator: 'contains', value: 'Ada' }]}
        onChange={() => undefined}
      />,
    );
    expect(markup).toContain('aria-label="Record filters, 1 active"');
    expect(markup).toContain('Filters');
  });

  test('offers Record, Schema, and Code inspection without a raw SQL console', () => {
    const markup = renderToStaticMarkup(
      <DataStudioInspector
        table={table}
        row={row}
        canManage={false}
        onEditSchema={() => undefined}
        onChangeStatus={() => undefined}
      />,
    );
    expect(markup).toContain('Record');
    expect(markup).toContain('Schema');
    expect(markup).toContain('Code');
    const example = dataStudioCodeExample(table);
    // Inactive animated tabs are intentionally not mounted during SSR.
    expect(example).toContain('client.dataStudio.listRows');
    expect(example).toContain('limit: 25');
    expect(example).not.toContain('limit: 50');
    expect(example.toLowerCase()).not.toContain('select ');
    expect(example.toLowerCase()).not.toContain(' from ');
  });
});
