/** Isolated generated-form fixture with optional/required schema defaults. */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { AutoForm } from './auto-form';

const choices = [{ label: 'Active', value: 'active' }, { label: 'Paused', value: 'paused' }];
const optional = defineSchema({
  text: field.text({ minLength: 3 }),
  textarea: field.textarea({ minLength: 3 }),
  email: field.email(),
  url: field.url(),
  password: field.password(),
  date: field.date(),
  datetime: field.datetime(),
  choice: field.select(choices),
  enumChoice: field.enum(['active', 'paused']),
  singleTeam: field.combobox(choices),
  multiChoice: field.multiSelect(choices),
  tags: field.tags(),
  teams: field.combobox(choices, { multiple: true }),
  window: field.dateRange(),
  settings: field.json(),
  enabled: field.boolean(),
  count: field.number(),
  owner: field.guardianUser({ required: false }),
  membership: field.guardianMembership({ required: false }),
});
const required = defineSchema({
  email: field.email({ required: true }),
  password: field.password({ required: true }),
  choice: field.select(choices, { required: true }),
  tags: field.tags({ required: true }),
  window: field.dateRange({ required: true }),
});
const optionalNumeric = defineSchema({ count: field.number({ min: 1 }) });
const requiredNumeric = defineSchema({ count: field.number({ min: 1, required: true }) });
const optionalSubmissions: Record<string, unknown>[] = [];
const requiredSubmissions: Record<string, unknown>[] = [];
const numericSubmissions: Record<string, unknown>[] = [];
const requiredNumericSubmissions: Record<string, unknown>[] = [];
let optionalSuccesses = 0;
let finish: (() => void) | null = null;
const errors: string[] = [];
const harness = {
  optionalSubmissions,
  requiredSubmissions,
  numericSubmissions,
  requiredNumericSubmissions,
  errors,
  optionalSuccesses: () => optionalSuccesses,
  resolve() { finish?.(); finish = null; },
};
declare global { interface Window { __autoFormDefaults: typeof harness } }
window.__autoFormDefaults = harness;

createRoot(document.getElementById('root')!).render(
  <>
    <section data-defaults-form="optional">
      <AutoForm schema={optional} submitLabel="Submit optional" onError={(error) => errors.push(error)}
        onSubmit={(data) => { optionalSubmissions.push(data); return new Promise<void>((resolve) => { finish = resolve; }); }}
        onSuccess={() => { optionalSuccesses += 1; }} />
    </section>
    <section data-defaults-form="required">
      <AutoForm schema={required} submitLabel="Submit required"
        onSubmit={(data) => { requiredSubmissions.push(data); }} />
    </section>
    <section data-defaults-form="numeric-create">
      <AutoForm schema={optionalNumeric} submitLabel="Create optional number"
        onSubmit={(data) => { numericSubmissions.push(data); }} />
    </section>
    <section data-defaults-form="numeric-edit">
      <AutoForm schema={optionalNumeric} mode="edit" defaultValues={{ count: 2 }} submitLabel="Clear optional number"
        onSubmit={(data) => { numericSubmissions.push(data); }} />
    </section>
    <section data-defaults-form="numeric-stored-null">
      <AutoForm schema={optionalNumeric} mode="edit" defaultValues={{ count: null }} submitLabel="Save stored null"
        onSubmit={(data) => { numericSubmissions.push(data); }} />
    </section>
    <section data-defaults-form="numeric-required">
      <AutoForm schema={requiredNumeric} mode="edit" defaultValues={{ count: 2 }} submitLabel="Clear required number"
        onSubmit={(data) => { requiredNumericSubmissions.push(data); }} />
    </section>
  </>,
);
