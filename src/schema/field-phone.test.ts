/** Phone declarations share client/headless/server mutation admission without changing SQL identity. */
import { expect, test } from 'bun:test';
import * as v from 'valibot';
import { field } from './field-types';
import { defineSchema, defineTable } from './define-schema';
import { SchemaConfigurationError } from './schema-configuration-error';
import { defineDatabaseRealm } from '../databases/database-realm';
import { SYNC_TABLE_MUTATION_VALIDATOR } from '../sync/types';

test('optional phone controls keep omission, explicit blank and SQL null semantics', () => {
  const schema = defineSchema({ phone: field.phone() });
  expect(schema.getDefaults()).toEqual({ phone: '' });
  expect(schema.validate({}).output).toEqual({ phone: '' });
  expect(schema.validate({ phone: '' }).success).toBe(true);
  expect(schema.validate({ phone: null }).success).toBe(true);
  expect(schema.validate({ phone: '+12135550123' }).success).toBe(true);
  expect(schema.validate({ phone: '+1213' }).success).toBe(false);
  expect(schema.validate({ phone: '2135550123' }).success).toBe(false);
  expect(schema.encodeRow({ phone: null })).toEqual({ phone: null });
  expect(schema.decodeRow({ phone: '+12135550123' })).toEqual({ phone: '+12135550123' });
});

test('required phone declarations reject clears and stay required even with defaults', () => {
  const definition = field.phone({ required: true, defaultValue: '+12135550123' });
  for (const value of [undefined, null, '', '+1213']) expect(v.safeParse(definition._schema, value).success).toBe(false);
  expect(v.safeParse(definition._schema, '+12135550123').success).toBe(true);
  expect(definition._sqlType).toBe('text not null');
});

test('explicit defaults use the same admission and retain no configured value in safe errors', () => {
  const schema = defineSchema({ phone: field.phone({ defaultValue: '+12135550123' }) });
  expect(schema.getDefaults()).toEqual({ phone: '+12135550123' });
  expect(schema.validate({}).output).toEqual(schema.getDefaults());
  expect(v.parse(field.phone({ defaultValue: null })._schema, undefined)).toBeNull();
  for (const options of [
    { defaultValue: 'not-a-phone' }, { defaultValue: '+1213' },
    { defaultValue: '2135550123' }, { required: true, defaultValue: null },
    { validation: 'valid' as const, defaultValue: '+12005550123' },
  ]) {
    try {
      field.phone(options);
      throw new Error('Expected a phone declaration failure.');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaConfigurationError);
      if (!(error instanceof SchemaConfigurationError)) throw error;
      expect(error.message).toBe('Invalid default value for phone field.');
      expect(error.code).toBe('SCHEMA_DEFAULT_INVALID');
    }
  }
});

test('default country remains form metadata only and cannot weaken canonical server admission', () => {
  const us = field.phone(), gb = field.phone({ defaultCountry: 'GB', validation: 'valid' });
  expect(us._meta).toMatchObject({ type: 'phone', defaultCountry: 'US', phoneValidation: 'possible', required: false });
  expect(gb._meta).toMatchObject({ type: 'phone', defaultCountry: 'GB', phoneValidation: 'valid' });
  expect(v.safeParse(gb._schema, '02079460123').success).toBe(false);
  expect(v.safeParse(gb._schema, '+442079460123').success).toBe(true);
  expect(v.safeParse(us._schema, '+12005550123').success).toBe(true);
  expect(v.safeParse(gb._schema, '+12005550123').success).toBe(false);
  expect(() => field.phone({ defaultCountry: 'XX' as never })).toThrow('Phone field defaultCountry must name a supported country.');
  expect(() => field.phone({ validation: 'unknown' as never })).toThrow('Phone field validation must be possible or valid.');
});

test('logical phone constraints survive the framework server mutation validator and realm cloning', () => {
  const table = defineTable('contacts', { phone: field.phone({ required: true }) }, { sync: 'full' });
  const realm = defineDatabaseRealm({ name: 'phone_test', version: '1', tables: { contacts: table.serverTable } });
  const validator = realm.tables.contacts?.[SYNC_TABLE_MUTATION_VALIDATOR];
  expect(validator).toBeDefined();
  if (!validator) throw new Error('Expected the declared phone mutation validator.');
  expect(validator.validateRow({ id: 'synthetic', phone: '+12135550123' }).success).toBe(true);
  for (const value of ['+1213', '', null, '2135550123']) {
    const result = validator.validateRow({ id: 'synthetic', phone: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues?.[0]?.path).toBe('phone');
  }
  expect(table.serverTable.phone).toBe('text not null');
  expect(table.clientTable.phone).toBe('text');
  expect(Object.keys(realm.tables.contacts!)).toEqual(['id', 'phone']);
});

test('phone presentation metadata adds no SQL columns or realm schema drift', () => {
  const us = defineTable('contacts', { phone: field.phone({ defaultCountry: 'US' }) });
  const gb = defineTable('contacts', { phone: field.phone({ defaultCountry: 'GB', validation: 'valid' }) });
  expect(Object.entries(us.serverTable)).toEqual([['id', 'text primary key'], ['phone', 'text']]);
  expect(Object.entries(gb.serverTable)).toEqual(Object.entries(us.serverTable));
  const left = defineDatabaseRealm({ name: 'phone_test', version: '1', tables: { contacts: us.serverTable } });
  const right = defineDatabaseRealm({ name: 'phone_test', version: '1', tables: { contacts: gb.serverTable } });
  expect(left.fingerprint).toBe(right.fingerprint);
});
