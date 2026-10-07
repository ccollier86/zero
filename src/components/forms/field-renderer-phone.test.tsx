/** Generated phone forms use the existing form registration and schema contract, not a separate submit path. */
import * as React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { field } from '../../schema/field-types';
import { defineSchema } from '../../schema/define-schema';
import { PhoneInput, type PhoneInputProps } from '../phone-input';
import { FormControl } from '../ui/form-field';
import { AutoForm } from './auto-form';
import { FieldRenderer, type FieldRendererProps } from './field-renderer';

type GeneratedPhoneProps = PhoneInputProps & { ref?: React.Ref<HTMLInputElement> };

function renderedPhone(props: Partial<FieldRendererProps> = {}) {
  const changes: unknown[] = [];
  const registration = { name: 'phone', value: null, onChange: (value: unknown) => { changes.push(value); }, onBlur() {}, ref() {} };
  const result = FieldRenderer({ name: 'phone', meta: field.phone()._meta, registration, ...props });
  if (!result) throw new Error('Expected a visible generated phone field.');
  const children = React.Children.toArray(result.props.children) as React.ReactElement<{ children?: React.ReactNode }>[];
  const control = children.find(child => child.type === FormControl);
  const input = control?.props.children as React.ReactElement<GeneratedPhoneProps> | undefined;
  expect(input?.type).toBe(PhoneInput);
  if (!input) throw new Error('Expected the generated phone control.');
  return { input, changes };
}

test('phone field metadata flows to the generated control and optional clears preserve null', () => {
  const { input, changes } = renderedPhone();
  expect(input.props).toMatchObject({ value: '', required: false, defaultCountry: 'US', validation: 'possible' });
  input.props.onChange?.('+12135550123');
  input.props.onChange?.('+1213');
  input.props.onChange?.('+');
  input.props.onChange?.('');
  expect(changes).toEqual(['+12135550123', '+1213', '+', null]);
});

test('null and undefined reset values both show an empty input without inventing a phone number', () => {
  for (const value of [null, undefined]) {
    const { input } = renderedPhone({ registration: { name: 'phone', value, onChange() {}, onBlur() {}, ref() {} } });
    expect(input.props.value).toBe('');
    expect(input.props.defaultCountry).toBe('US');
  }
});

test('required phone clears remain invalid drafts and presentation overrides keep schema constraints', () => {
  const { input, changes } = renderedPhone({
    meta: field.phone({ required: true, defaultCountry: 'GB', validation: 'valid', placeholder: 'Your phone number' })._meta,
    overrides: { defaultCountry: 'CA', readOnly: true, autoFocus: true },
  });
  expect(input.props).toMatchObject({ required: true, defaultCountry: 'CA', validation: 'valid', placeholder: 'Your phone number', readOnly: true, autoFocus: true });
  input.props.onChange?.('');
  expect(changes).toEqual(['']);
});

test('phone form registration forwards native refs and blur for ordinary touched/error lifecycle', () => {
  const changes: unknown[] = [];
  let blurred = false;
  const reference = (node: HTMLElement | null) => { changes.push(node); };
  const { input } = renderedPhone({ registration: { name: 'phone', value: '+442079460123', onChange() {}, onBlur() { blurred = true; }, ref: reference } });
  expect(input.props.value).toBe('+442079460123');
  input.props.onBlur?.({} as React.FocusEvent<HTMLInputElement>);
  expect(blurred).toBe(true);
  expect(input.props.ref).toBe(reference);
});

test('AutoForm renders the reusable phone control with native accessible readonly field semantics', () => {
  const schema = defineSchema({ phone: field.phone({ label: 'Contact phone', description: 'Include the country code', defaultValue: '+12135550123' }) });
  const html = renderToStaticMarkup(<AutoForm schema={schema} fields={{ phone: { readOnly: true } }} onSubmit={() => {}} />);
  expect(html).toContain('data-slot="phone-input"');
  expect(html).toContain('data-readonly="true"');
  expect(html).toMatch(/<input\b[^>]*\breadonly=""/iu);
  expect(html).toContain('name="phone"');
  expect(html).toContain('value="+12135550123"');
  expect(html).toContain('Contact phone');
  expect(html).toContain('aria-describedby=');
});
