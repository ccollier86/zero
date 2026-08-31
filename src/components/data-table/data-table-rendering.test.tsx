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
});
