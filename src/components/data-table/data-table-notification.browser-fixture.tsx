/** Actual DataTable accepted source writes versus legacy array writer callbacks. */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../../frontend/client/observability';
import { DataTable } from './data-table';

const schema = defineSchema({ name: field.text({ required: true }) });
const events: FrontendObservabilityEvent[] = [];
configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
let writes = 0;
let notifications = 0;
let accept: () => void = () => undefined;
type Mode = 'accepted' | 'array' | 'async-accepted';
let chooseMode: (mode: Mode) => void = () => undefined;
let rejectNotification: () => void = () => undefined;

function Fixture() {
  const [name, setName] = React.useState('before-edit');
  const [mode, setMode] = React.useState<Mode>('accepted');
  chooseMode = setMode;
  return <DataTable
    schema={schema} columns={['name']} editable={['name']}
    source={mode !== 'array'
      ? { type: 'data', data: [{ id: 'synthetic-row', name }], actions: {
        update: (_id, patch) => {
          writes += 1;
          return new Promise<void>((resolve) => { accept = () => { setName(String(patch.name)); resolve(); }; });
        },
      } }
      : { type: 'data', data: [{ id: 'synthetic-row', name }] }}
    onCellEdit={() => {
      notifications += 1;
      if (mode === 'async-accepted') return new Promise<void>((_resolve, reject) => {
        rejectNotification = () => reject(new Error('obsolete private callback contents'));
      });
      throw new Error('private legacy callback contents');
    }}
  />;
}

window.__tableNotificationHarness = {
  counts: () => ({ writes, notifications }),
  accept: () => accept(), mode: (mode) => chooseMode(mode),
  events: () => events,
  rejectNotification: () => rejectNotification(),
  unmount: () => root.unmount(),
};
const root = createRoot(document.getElementById('root')!);
root.render(<Fixture />);

declare global {
  interface Window {
    __tableNotificationHarness: {
      counts(): { writes: number; notifications: number };
      accept(): void;
      mode(mode: Mode): void;
      events(): FrontendObservabilityEvent[];
      rejectNotification(): void;
      unmount(): void;
    };
  }
}
