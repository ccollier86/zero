import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';

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
