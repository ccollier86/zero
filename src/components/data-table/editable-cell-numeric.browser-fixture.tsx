/** Isolated real inline numeric editor with schema-validated write receipts. */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { EditableCell } from './editable-cell';

const optionalSchema = defineSchema({ count: field.number({ min: 1 }) });
const requiredSchema = defineSchema({ count: field.number({ min: 1, required: true }) });
const writes: Record<string, unknown[]> = { optional: [], required: [] };
const stored: Record<string, unknown> = { optional: 2, required: 2 };
const accepted: Record<string, number> = { optional: 0, required: 0 };
let finish: (() => void) | null = null;
const harness = {
  writes, stored, accepted,
  resolve() { finish?.(); finish = null; },
};
declare global { interface Window { __inlineNumericDefaults: typeof harness } }
window.__inlineNumericDefaults = harness;

function NumericCell({ required }: { required: boolean }) {
  const kind = required ? 'required' : 'optional';
  const descriptor = required ? requiredSchema : optionalSchema;
  const [value, setValue] = React.useState<unknown>(2);
  const [editing, setEditing] = React.useState(false);
  return <section data-numeric-cell={kind}>
    <EditableCell value={value} rowId={kind} columnId="count"
      fieldMeta={descriptor.fields.get('count')} isEditing={editing}
      onStartEdit={() => setEditing(true)} onCancel={() => setEditing(false)}
      refreshOnSuccess={false}
      onSave={async (_rowId, _columnId, next) => {
        const wire: { count: unknown } = JSON.parse(JSON.stringify({ count: next }));
        writes[kind]!.push(wire.count);
        const validated = descriptor.validate(wire);
        if (!validated.success) throw new Error('Synthetic schema rejected numeric clear');
        await new Promise<void>((resolve) => { finish = resolve; });
        const committed = descriptor.encodeRow(validated.output).count;
        stored[kind] = committed;
        setValue(descriptor.decodeField('count', committed));
      }}
      onAccepted={() => {
        accepted[kind]! += 1;
        setEditing(false);
      }} />
  </section>;
}

createRoot(document.getElementById('root')!).render(
  <><NumericCell required={false} /><NumericCell required /></>,
);
