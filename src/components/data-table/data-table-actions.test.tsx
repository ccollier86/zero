import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  dataTableActionDisabled,
  dataTableActionDisabledReason,
} from './data-table-action-contracts';
import {
  DataTableBulkActions,
  type DataTableAllMatchingBulkSelection,
} from './data-table-bulk-actions';
import { DataTableRowActions, type RowAction } from './data-table-row-actions';
import type {
  DataTableMutationOperation,
  DataTableMutationRunner,
} from './use-data-table-mutation';

const idleRunner: DataTableMutationRunner = {
  boundaryKey: 'test',
  async run<Result>(operation: DataTableMutationOperation<Result>): Promise<Result> {
    return operation.execute({
      signal: new AbortController().signal,
      operationId: 'test-operation',
    });
  },
  async retry<Result>(): Promise<Result> {
    return undefined as Result;
  },
  isPending: () => false,
  getError: () => null,
  clearError: () => undefined,
};

describe('DataTable action controls', () => {
  test('keeps the legacy one-argument row callback source-compatible', () => {
    const action: RowAction<{ id: string }> = {
      label: 'Open',
      onClick: (row) => { void row.id; },
    };
    const markup = renderToStaticMarkup(
      <DataTableRowActions
        row={{ id: 'one' }}
        rowId="one"
        actions={[action]}
        mutationRunner={idleRunner}
      />,
    );
    expect(markup).toContain('Open row actions');
  });

  test('renders page-selected bulk actions and evaluates disabled policy', () => {
    const selection = {
      scope: 'page' as const,
      rows: [{ id: 'one' }, { id: 'two' }],
      rowIds: ['one', 'two'],
    };
    const markup = renderToStaticMarkup(
      <DataTableBulkActions
        selection={selection}
        mutationRunner={idleRunner}
        actions={[{
          id: 'archive',
          label: 'Archive',
          disabled: (target) => target.scope === 'page' && target.rowIds.length > 1,
          disabledReason: 'Choose one row',
          onClick: async () => undefined,
        }]}
      />,
    );
    expect(markup).toContain('2 selected');
    expect(markup).toContain('Archive');
    expect(markup).toContain('disabled');
    expect(markup).toContain('Choose one row');
  });

  test('requires an explicit target and identity for all-matching controls', () => {
    const selection: DataTableAllMatchingBulkSelection<{ queryToken: string }> = {
      scope: 'all-matching',
      target: { queryToken: 'opaque-query' },
      selectionKey: 'query-revision-7',
      total: 125,
    };
    const markup = renderToStaticMarkup(
      <DataTableBulkActions<{ id: string }, { queryToken: string }>
        selection={selection}
        mutationRunner={idleRunner}
        actions={[{
          label: 'Export matching',
          onClick: (_target, context) => { void context?.signal; },
        }]}
      />,
    );
    expect(markup).toContain('125 selected');
    expect(markup).toContain('Export matching');
  });

  test('resolves boolean and row-aware disabled contracts', () => {
    const target = { locked: true };
    expect(dataTableActionDisabled({ disabled: false }, target)).toBe(false);
    expect(dataTableActionDisabled({ disabled: (row) => row.locked }, target)).toBe(true);
    expect(dataTableActionDisabledReason({
      disabledReason: (row) => row.locked ? 'Locked record' : undefined,
    }, target)).toBe('Locked record');
  });
});
