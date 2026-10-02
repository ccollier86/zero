/**
 * Verifies DataTable's public toolbar composition, compact-search markup, and
 * table-aware slot context. Effect-driven search interaction is covered by the
 * browser lifecycle suite.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import { DataTableSearch } from './data-table-search';

const userSchema = defineSchema({
  username: field.text({ label: 'Username' }),
  status: field.select([
    { label: 'Active', value: 'active' },
    { label: 'Suspended', value: 'suspended' },
  ], { label: 'Status' }),
});

const users = [
  { id: 'user-1', username: 'casey', status: 'active' },
  { id: 'user-2', username: 'ada', status: 'suspended' },
];

describe('DataTable toolbar', () => {
  test('renders compact search, generated filters, and semantic slots in stable order', () => {
    const markup = renderToStaticMarkup(
      <DataTable
        schema={userSchema}
        primaryKey="id"
        data={users}
        selectable
        searchable={{
          placeholder: 'Find a person…',
          ariaLabel: 'Search people',
          collapsedWidth: 108,
          expandedWidth: 196,
        }}
        filterable
        filterColumns={['status']}
        initialState={{
          globalFilter: 'casey',
          columnFilters: [{ id: 'status', value: 'active' }],
          rowSelection: { 'user-1': true },
        }}
        toolbarSlots={{
          controls: ({ activeFilterCount }) => (
            <button type="button" data-slot-test="controls">
              Filters {activeFilterCount}
            </button>
          ),
          actions: ({ selectedRowCount, selectedRowIds }) => (
            <button type="button" data-slot-test="actions">
              Archive {selectedRowCount}:{selectedRowIds.join(',')}
            </button>
          ),
          supplemental: ({ hasActiveSearch, hasActiveFilters }) => (
            <span data-slot-test="supplemental">
              {String(hasActiveSearch)}:{String(hasActiveFilters)}
            </span>
          ),
        }}
        toolbarActions={({ query }) => (
          <button type="button" data-slot-test="legacy-action">
            Legacy {query}
          </button>
        )}
      />,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Table controls"');
    expect(markup).toContain('data-slot="data-table-search"');
    expect(markup).toContain('data-open="true"');
    expect(markup).toContain('aria-label="Search people"');
    expect(markup).toContain('placeholder="Find a person…"');
    expect(markup).toContain('aria-label="Filter by Status"');
    expect(markup).toContain('Filters 1');
    expect(markup).toContain('Archive 1:user-1');
    expect(markup).toContain('true:true');
    expect(markup).toContain('Legacy casey');
    expect(markup).toContain('Status: active');
    expect(markup).toContain('aria-label="Clear Status filter"');
    expect(markup).toContain('>Clear all</button>');

    expect(markup.indexOf('aria-label="Search people"'))
      .toBeLessThan(markup.indexOf('aria-label="Filter by Status"'));
    expect(markup.indexOf('aria-label="Filter by Status"'))
      .toBeLessThan(markup.indexOf('data-slot-test="controls"'));
    expect(markup.indexOf('data-slot-test="actions"'))
      .toBeLessThan(markup.indexOf('data-slot-test="legacy-action"'));
    expect(markup.indexOf('data-slot-test="legacy-action"'))
      .toBeLessThan(markup.indexOf('>Columns</button>'));
  });

  test('shows a toolbar for custom slots even when search and generated filters are off', () => {
    const markup = renderToStaticMarkup(
      <DataTable
        schema={userSchema}
        primaryKey="id"
        data={users}
        searchable={false}
        showColumnVisibility={false}
        showExport={false}
        toolbarSlots={{
          controls: <button type="button">Custom filter</button>,
          actions: <button type="button">Create user</button>,
        }}
      />,
    );

    expect(markup).toContain('data-slot="data-table-toolbar"');
    expect(markup).toContain('Custom filter');
    expect(markup).toContain('Create user');
    expect(markup).not.toContain('data-slot="data-table-search"');
    expect(markup).not.toContain('>Columns</button>');
    expect(markup).not.toContain('>Export</button>');
  });

  test('does not render a toolbar for an empty slots object alone', () => {
    const markup = renderToStaticMarkup(
      <DataTable
        schema={userSchema}
        primaryKey="id"
        data={users}
        toolbarSlots={{}}
      />,
    );

    expect(markup).not.toContain('data-slot="data-table-toolbar"');
  });
});

describe('DataTableSearch server contract', () => {
  test('renders a compact, labelled, table-specific searchbox', () => {
    const markup = renderToStaticMarkup(
      <DataTableSearch value="" onValueChange={() => undefined} />,
    );

    expect(markup).toContain('data-slot="data-table-search"');
    expect(markup).toContain('data-open="false"');
    expect(markup).toContain('role="searchbox"');
    expect(markup).toContain('aria-label="Search table"');
    expect(markup).toContain('placeholder="Search…"');
    expect(markup).toContain('focus-within:ring-2');
    expect(markup).toContain('bg-card');
    expect(markup).toContain('text-card-foreground');
    expect(markup).toContain('placeholder:text-muted-foreground');
    expect(markup).not.toContain('bg-foreground text-background');
    expect(markup).not.toContain('aria-label="Clear search"');
  });

  test('uses a unique SVG filter for every mounted table search', () => {
    const markup = renderToStaticMarkup(
      <>
        <DataTableSearch value="" onValueChange={() => undefined} />
        <DataTableSearch value="active" onValueChange={() => undefined} />
      </>,
    );
    const ids = Array.from(markup.matchAll(/<filter id="([^"]+)"/g)).map(
      ([, id]) => id,
    );

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(markup).toContain(`url(#${id})`);
    expect(markup).toContain('aria-label="Clear search"');
  });
});
