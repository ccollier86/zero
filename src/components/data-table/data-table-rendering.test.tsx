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
    expect(markup).toContain('>Open menu</span>');
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
