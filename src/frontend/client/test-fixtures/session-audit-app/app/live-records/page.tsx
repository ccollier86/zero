'use client';
import { useState } from 'react';
import { MasterDetailPage } from '@zero/framework/components/master-detail';
import { defineSchema, field } from '@zero/framework/schema';
import { useCollection, useClient } from '@zero/framework/react';
const schema = defineSchema({ id: field.text({ label: 'Record' }), state: field.text({ label: 'State' }), title: field.text({ label: 'Title' }) });
export const config = { auth: 'admin' };
export default function LiveRecords() {
  const [completed, setCompleted] = useState(false), collection = useCollection('audit_items'), client = useClient();
  return <main data-testid="native-live-records"><h1>Reactive records</h1>
    <button type="button" onClick={() => setCompleted(value => !value)}>Show completed reactive records</button>
    <button type="button" onClick={() => { void client.fetch('/proof/record-state', { method: 'POST', body: {} }); }}>Make second record draft</button>
    <MasterDetailPage schema={schema} listColumns={['id', 'state', 'title']} data={collection.data.filter(row => !completed || row.state === 'approved')}
      autoSelectFirst={false} paginated={{ pageSize: 20 }} searchable={false} sortable={false} liveUpdates={false}
      renderDetail={item => <h2 data-testid="native-live-record-detail">Record {String(item.id)}</h2>} />
  </main>;
}
