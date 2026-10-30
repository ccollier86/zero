'use client';
import { useState } from 'react';
import { DataTable } from '@zero/framework/components/data-table';
import { defineSchema, field } from '@zero/framework/schema';
import { useRouter } from '@zero/framework/react';
const schema = defineSchema({ id: field.text({ label: 'Record' }), state: field.text({ label: 'State' }), title: field.text({ label: 'Title' }) });
export const config = { auth: 'admin' };
export default function Records() {
  const [complete, setComplete] = useState(false), router = useRouter();
  return <main data-testid="native-audit-records"><h1>Synthetic records</h1><button type="button" onClick={() => setComplete(value => !value)}>Show completed records</button>
    <DataTable schema={schema} source={{ type: 'server', table: 'audit_items', prefetch: false }} state={{ columnFilters: complete ? [{ id: 'state', value: 'approved' }] : [] }}
      paginated={{ pageSize: 20 }} sortable={false} searchable={false} selectable={false} showExport={false} onRowClick={row => router.push('/records/' + row.id)} />
  </main>;
}
