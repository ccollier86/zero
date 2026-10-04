import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import { handleDataTableRowKeyDown } from './data-table-row-interaction';

const userSchema = defineSchema({
  username: field.text({ label: 'Username' }),
  email: field.email({ label: 'Email' }),
  role: field.text({ label: 'Role' }),
  status: field.text({ label: 'Status' }),
});

describe('DataTable cell rendering', () => {
  test('renders every supplied row when pagination is disabled', () => {
    const rows = Array.from({ length: 35 }, (_, index) => ({ id: `row-${index}`, username: `record-${index}` }));
    const allRows = renderToStaticMarkup(
      <DataTable schema={userSchema} primaryKey="id" columns={['username']} data={rows} paginated={false} />,
    );
    const firstPage = renderToStaticMarkup(
      <DataTable schema={userSchema} primaryKey="id" columns={['username']} data={rows} paginated={{ pageSize: 20 }} />,
    );
    expect(allRows).toContain('record-34');
    expect(allRows).not.toContain('data-table-pagination');
    expect(firstPage).toContain('record-19');
    expect(firstPage).not.toContain('record-20');
    expect(firstPage).toContain('Showing 1-20 of 35');
  });
  test('renders accessor values when a column has no custom cell override', () => {
    const markup = renderToStaticMarkup(
      <DataTable
        schema={userSchema}
        primaryKey="id"
        columns={['username', 'email', 'role', 'status']}
        data={[{
          id: 'user-1',
          username: 'casey',
          email: 'casey@example.com',
          role: 'admin',
          status: 'active',
        }]}
      />,
    );

    expect(markup).toContain('casey');
    expect(markup).toContain('casey@example.com');
    expect(markup).toContain('admin');
    expect(markup).toContain('active');
  });

  test('preserves a custom column cell renderer', () => {
    const markup = renderToStaticMarkup(
      <DataTable
        schema={userSchema}
        primaryKey="id"
        columns={['username']}
        columnOverrides={{
          username: {
            cell: ({ value }) => `User: ${String(value)}`,
          },
        }}
        data={[{
          id: 'user-1',
          username: 'casey',
          email: 'casey@example.com',
          role: 'admin',
          status: 'active',
        }]}
      />,
    );

    expect(markup).toContain('User: casey');
  });

  test('renders responsive, labelled pagination controls', () => {
    const markup = renderToStaticMarkup(
      <DataTable
        schema={userSchema}
        primaryKey="id"
        columns={['username']}
        data={[{
          id: 'user-1',
          username: 'casey',
          email: 'casey@example.com',
          role: 'admin',
          status: 'active',
        }]}
        paginated
      />,
    );

    expect(markup).toContain('data-slot="data-table-pagination"');
    expect(markup).toContain('flex-col gap-3');
    expect(markup).toContain('flex-wrap items-center');
    expect(markup).toContain('aria-label="Rows per page"');
    expect(markup).toContain('aria-label="First page"');
    expect(markup).toContain('aria-label="Previous page"');
    expect(markup).toContain('aria-label="Next page"');
    expect(markup).toContain('aria-label="Last page"');
  });

  test('uses exact schema filters and accepts scalar numeric filter values', () => {
    const filterSchema = defineSchema({
      username: field.text({ label: 'Username' }),
      status: field.select([
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
      ], { label: 'Status' }),
      score: field.number({ label: 'Score' }),
    });
    const rows = [
      { id: 'user-1', username: 'exact-active', status: 'active', score: 2 },
      { id: 'user-2', username: 'substring-inactive', status: 'inactive', score: 2 },
      { id: 'user-3', username: 'wrong-score', status: 'active', score: 3 },
    ];
    const markup = renderToStaticMarkup(
      <DataTable
        schema={filterSchema}
        primaryKey="id"
        data={rows}
        initialState={{
          columnFilters: [
            { id: 'status', value: 'active' },
            { id: 'score', value: 2 },
          ],
        }}
      />,
    );

    expect(markup).toContain('exact-active');
    expect(markup).not.toContain('substring-inactive');
    expect(markup).not.toContain('wrong-score');
  });
});

describe('DataTable row interaction', () => {
  test('makes clickable rows focusable while preserving table row semantics', () => {
    const markup = renderToStaticMarkup(
      <DataTable
        schema={userSchema}
        primaryKey="id"
        columns={['username']}
        data={[{
          id: 'user-1',
          username: 'casey',
          email: 'casey@example.com',
          role: 'admin',
          status: 'active',
        }]}
        selectable
        actions={[{ label: 'Deactivate', onClick: () => undefined }]}
        highlightedRowId="user-1"
        onRowClick={() => undefined}
      />,
    );
    const row = firstBodyRowOpeningTag(markup);

    expect(row).toContain('tabindex="0"');
    expect(row).toContain('aria-current="true"');
    expect(row).toContain('focus-visible:ring-2');
    expect(row).not.toContain('role="button"');
    expect(markup).toContain('aria-label="Select row"');
    expect(markup).toContain('>Open row actions</span>');
  });

  test('keeps rows without a click handler out of the tab order', () => {
    const markup = renderToStaticMarkup(
      <DataTable
        schema={userSchema}
        primaryKey="id"
        columns={['username']}
        data={[{
          id: 'user-1',
          username: 'casey',
          email: 'casey@example.com',
          role: 'admin',
          status: 'active',
        }]}
      />,
    );

    expect(firstBodyRowOpeningTag(markup)).not.toContain('tabindex=');
  });

  test('activates a focused row with Enter or Space', () => {
    const row = { id: 'user-1' };
    const activated: typeof row[] = [];
    const enter = keyboardEvent('Enter');
    const space = keyboardEvent(' ');

    handleDataTableRowKeyDown(enter.event, row, (value) => activated.push(value));
    handleDataTableRowKeyDown(space.event, row, (value) => activated.push(value));

    expect(activated).toEqual([row, row]);
    expect(enter.defaultPrevented()).toBe(false);
    expect(space.defaultPrevented()).toBe(true);
  });

  test('ignores other keys and keyboard events from checkbox or action controls', () => {
    const row = { id: 'user-1' };
    const activated: typeof row[] = [];
    const arrow = keyboardEvent('ArrowDown');
    const checkboxSpace = keyboardEvent(' ', new EventTarget());
    const actionEnter = keyboardEvent('Enter', new EventTarget());

    handleDataTableRowKeyDown(arrow.event, row, (value) => activated.push(value));
    handleDataTableRowKeyDown(checkboxSpace.event, row, (value) => activated.push(value));
    handleDataTableRowKeyDown(actionEnter.event, row, (value) => activated.push(value));

    expect(activated).toEqual([]);
    expect(arrow.defaultPrevented()).toBe(false);
    expect(checkboxSpace.defaultPrevented()).toBe(false);
    expect(actionEnter.defaultPrevented()).toBe(false);
  });
});

function firstBodyRowOpeningTag(markup: string): string {
  const body = markup.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  const row = body?.match(/<tr\b[^>]*>/)?.[0];
  if (!row) throw new Error('Expected DataTable markup to contain a body row');
  return row;
}

function keyboardEvent(key: string, target?: EventTarget) {
  const currentTarget = new EventTarget() as EventTarget & HTMLTableRowElement;
  let prevented = false;

  return {
    event: {
      key,
      currentTarget,
      target: target ?? currentTarget,
      preventDefault() {
        prevented = true;
      },
    },
    defaultPrevented: () => prevented,
  };
}
