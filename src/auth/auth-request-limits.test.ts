import { describe, expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { AUTH_REQUEST_LIMITS as LIMIT } from './auth-request-limits';
import {
  assertAuthPropertiesBound,
  assertAuthPropertyValueBound,
} from './auth-request-property-bounds';
import {
  authLoginIdentifierSchema,
  authNewPasswordSchema,
  authPropertiesSchema,
  authPropertyKeySchema,
  authTokenSchema,
} from './auth-request-schema';
import { AuthError } from './types';

describe('auth request limits', () => {
  test('accepts exact string boundaries and rejects one character over', () => {
    expect(Value.Check(authLoginIdentifierSchema, 'u'.repeat(LIMIT.loginIdentifier))).toBe(true);
    expect(Value.Check(authLoginIdentifierSchema, 'u'.repeat(LIMIT.loginIdentifier + 1))).toBe(false);
    expect(Value.Check(authNewPasswordSchema, 'p'.repeat(LIMIT.password))).toBe(true);
    expect(Value.Check(authNewPasswordSchema, 'p'.repeat(LIMIT.password + 1))).toBe(false);
    expect(Value.Check(authTokenSchema, 't'.repeat(LIMIT.token))).toBe(true);
    expect(Value.Check(authTokenSchema, 't'.repeat(LIMIT.token + 1))).toBe(false);
    expect(Value.Check(authPropertyKeySchema, 'k'.repeat(LIMIT.propertyKey))).toBe(true);
    expect(Value.Check(authPropertyKeySchema, 'k'.repeat(LIMIT.propertyKey + 1))).toBe(false);
  });

  test('bounds property counts and keys without narrowing JSON value types', () => {
    const accepted = Object.fromEntries(Array.from(
      { length: LIMIT.propertyCount },
      (_, index) => [`property-${index}`, index % 2 ? [index] : { index }]
    ));
    expect(Value.Check(authPropertiesSchema, accepted)).toBe(true);
    expect(Value.Check(authPropertiesSchema, {
      ...accepted,
      overflow: true,
    })).toBe(false);
    expect(Value.Check(authPropertiesSchema, {
      ['k'.repeat(LIMIT.propertyKey + 1)]: true,
    })).toBe(false);
  });

  test('bounds serialized property values and the aggregate payload', () => {
    expect(() => assertAuthPropertyValueBound('v'.repeat(LIMIT.propertyValue))).not.toThrow();
    expectValidation(() => assertAuthPropertyValueBound('v'.repeat(LIMIT.propertyValue + 1)));
    expectValidation(() => assertAuthPropertiesBound({
      a: 'v'.repeat(LIMIT.propertyValue),
      b: 'v'.repeat(LIMIT.propertyValue),
      c: 'v'.repeat(LIMIT.propertyValue),
      d: 'v'.repeat(LIMIT.propertyValue),
    }));
  });
});

function expectValidation(action: () => void): void {
  try {
    action();
    throw new Error('Expected auth validation failure');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe('AUTH_VALIDATION_FAILED');
    expect((error as AuthError).status).toBe(422);
  }
}
