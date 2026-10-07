/** Synthetic native/form-adapter fixture; no account, transport or persistence is started. */
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PhoneInput } from './phone-input';
import { Input } from '../ui/input';
import { defineSchema, field } from '../../schema';
import { AutoForm } from '../forms/auto-form';

const changes: string[] = [], countryChanges: (string | undefined)[] = [];
const optionalSubmissions: unknown[] = [], requiredSubmissions: unknown[] = [];
const optional = defineSchema({ phone: field.phone({ label: 'Optional phone', defaultCountry: 'FR' }) });
const required = defineSchema({ phone: field.phone({ label: 'Required phone', required: true }) });
const harness = { changes, countryChanges, optionalSubmissions, requiredSubmissions,
  setReadOnly: (_next: boolean) => {}, reset: (_next: string | undefined | null) => {}, focus: () => {} };
declare global { interface Window { __phoneInput: typeof harness } }
window.__phoneInput = harness;
function Fixture() {
  const [value, setValue] = useState<string | undefined | null>(''), [readOnly, setReadOnly] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  harness.setReadOnly = setReadOnly; harness.reset = setValue; harness.focus = () => ref.current?.focus();
  return <div className="mx-auto grid max-w-xl gap-4 p-6">
    <form id="native"><label htmlFor="controlled">Phone number</label>
      <PhoneInput id="controlled" name="phone" ref={ref} value={value} readOnly={readOnly} countries={['US', 'FR', 'GB']}
        onChange={next => { changes.push(next); setValue(next); }} onCountryChange={country => countryChanges.push(country)} />
      <PhoneInput aria-label="Read-only phone" name="readonly" value="+12025550123" readOnly />
      <PhoneInput aria-label="Disabled phone" name="disabled" value="+12025550123" disabled />
      <PhoneInput aria-label="Uncontrolled phone" name="uncontrolled" defaultCountry="FR" defaultValue="+33612345678" />
      <PhoneInput aria-label="Small phone" variant="sm" defaultCountry="FR" />
      <PhoneInput aria-label="Large phone" variant="lg" defaultCountry="GB" />
      <Input aria-label="Ordinary read-only input" name="ordinary" readOnly defaultValue="Synthetic read-only text" />
    </form>
    <PhoneInput aria-label="Associated phone" name="associated" form="native" value="+442079460018" readOnly />
    <section data-case="optional"><AutoForm schema={optional} submitLabel="Save optional" mode="edit" defaultValues={{ phone: '+33612345678' }} onSubmit={data => { optionalSubmissions.push(data); }} /></section>
    <section data-case="required"><AutoForm schema={required} submitLabel="Save required" onSubmit={data => { requiredSubmissions.push(data); }} /></section>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
