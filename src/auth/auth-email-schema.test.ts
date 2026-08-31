import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { canonicalEmailSchema } from './auth-email-schema';

describe('canonicalEmailSchema', () => {
  test('canonicalizes ordinary whitespace and rejects oversized input', () => {
    expect(Value.Decode(canonicalEmailSchema, '  User@Example.COM  '))
      .toBe('user@example.com');
    expect(Value.Check(canonicalEmailSchema, `${'a'.repeat(243)}@example.com`))
      .toBe(false);
  });
});
