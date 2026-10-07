/** Declares a validated E.164 TEXT scalar and phone-specific form metadata. */

import * as v from 'valibot';
import { isPhoneCountry, isPhoneNumber, type PhoneCountry, type PhoneNumberValidation } from '../lib/phone-number';
import type { FieldDef } from './field-types';
import type { NullableFieldSchema, NullableValue } from './field-schema-types';
import { scalarFieldSchema } from './field-schema-validation';

export interface PhoneFieldOptions {
  label?: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string | null;
  /** Form presentation only. Server input must already be canonical E.164. */
  defaultCountry?: PhoneCountry;
  /** Numbering-plan validation, not contact verification. Defaults to `possible`. */
  validation?: PhoneNumberValidation;
  tableVisible?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  columnWidth?: number;
}

export function phone(opts?: undefined): FieldDef<NullableFieldSchema<string, undefined>, NullableValue<string, undefined>>;
export function phone<const Options extends PhoneFieldOptions | undefined>(opts: Options): FieldDef<NullableFieldSchema<string, Options>, NullableValue<string, Options>>;
export function phone(opts: PhoneFieldOptions = {}): FieldDef<NullableFieldSchema<string, PhoneFieldOptions>, NullableValue<string, PhoneFieldOptions>> {
  const defaultCountry = opts.defaultCountry ?? 'US';
  const validation = opts.validation ?? 'possible';
  if (!isPhoneCountry(defaultCountry)) throw new TypeError('Phone field defaultCountry must name a supported country.');
  if (validation !== 'possible' && validation !== 'valid') throw new TypeError('Phone field validation must be possible or valid.');
  const base = v.pipe(v.string(), v.check(
    (value) => isPhoneNumber(value, validation),
    validation === 'valid'
      ? 'Enter a valid international phone number.'
      : 'Enter a complete international phone number.',
  ));
  const schema = scalarFieldSchema('phone', base, opts);
  return {
    _schema: schema,
    _meta: {
      type: 'phone', label: opts.label, placeholder: opts.placeholder, description: opts.description,
      required: opts.required ?? false, defaultValue: opts.defaultValue,
      tableVisible: opts.tableVisible, sortable: opts.sortable, filterable: opts.filterable,
      columnWidth: opts.columnWidth, defaultCountry, phoneValidation: validation,
    },
    _sqlType: opts.required ? 'text not null' : 'text',
    _clientType: 'text',
  };
}
