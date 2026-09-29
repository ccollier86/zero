import { describe, expect, test } from 'bun:test';

import {
  DATABASE_ERROR_CODES,
  DATABASE_ERROR_DETAILS_MAX_ENTRIES,
  DATABASE_ERROR_DETAIL_KEY_MAX_LENGTH,
  DATABASE_ERROR_DETAIL_STRING_MAX_LENGTH,
  DATABASE_ERROR_ENVELOPE_KIND,
  DATABASE_ERROR_ENVELOPE_VERSION,
  DatabaseError,
  deserializeDatabaseError,
  isDatabaseError,
  isDatabaseErrorCode,
  isSerializedDatabaseError,
  normalizeDatabaseError,
  serializeDatabaseError,
  type DatabaseErrorCode,
  type DatabaseOperationOutcome,
  type SerializedDatabaseError,
} from './database-error';

const EXPECTED_DEFAULTS = {
  DATABASE_CONFIG_INVALID: [false, 'not-started'],
  DATABASE_DISABLED: [false, 'not-started'],
  DATABASE_NOT_READY: [true, 'not-started'],
  DATABASE_CLOSED: [false, 'not-started'],
  DATABASE_BACKPRESSURE: [true, 'not-started'],
  DATABASE_CAPACITY_EXHAUSTED: [false, 'not-started'],
  DATABASE_QUEUE_TIMEOUT: [true, 'not-started'],
  DATABASE_OPERATION_TIMEOUT: [false, 'unknown'],
  DATABASE_EXECUTOR_START_FAILED: [true, 'not-started'],
  DATABASE_EXECUTOR_FAILED: [false, 'unknown'],
  DATABASE_PROTOCOL_ERROR: [false, 'unknown'],
  DATABASE_OPEN_FAILED: [true, 'not-started'],
  DATABASE_MIGRATION_FAILED: [false, 'unknown'],
  DATABASE_SCHEMA_MISMATCH: [false, 'not-started'],
  DATABASE_AUTHORITY_CHANGED: [false, 'not-started'],
  DATABASE_CONFLICT: [true, 'not-committed'],
  DATABASE_HISTORY_GAP: [false, null],
  DATABASE_PAYLOAD_INVALID: [false, 'not-started'],
  DATABASE_PAYLOAD_LIMIT: [false, 'not-started'],
  DATABASE_RESULT_LIMIT: [false, 'unknown'],
  DATABASE_OPERATION_UNSUPPORTED: [false, 'not-started'],
  DATABASE_TRANSACTION_EXPIRED: [false, 'not-committed'],
  DATABASE_TRANSACTION_STALE: [false, 'not-started'],
  DATABASE_OUTCOME_UNKNOWN: [false, 'unknown'],
} as const satisfies Record<
  DatabaseErrorCode,
  readonly [boolean, DatabaseOperationOutcome | null]
>;

describe('DatabaseError', () => {
  test('has a closed code set with conservative explicit defaults', () => {
    expect(new Set(DATABASE_ERROR_CODES).size).toBe(DATABASE_ERROR_CODES.length);
    expect(Object.keys(EXPECTED_DEFAULTS).sort()).toEqual(
      [...DATABASE_ERROR_CODES].sort(),
    );

    for (const code of DATABASE_ERROR_CODES) {
      const error = new DatabaseError(code, 'Safe database failure.');
      const [retryable, outcome] = EXPECTED_DEFAULTS[code];

      expect(error.name).toBe('DatabaseError');
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(retryable);
      expect(error.outcome).toBe(outcome);
      expect(error.details).toEqual({});
      expect(Object.isFrozen(error.details)).toBe(true);
      expect(isDatabaseErrorCode(code)).toBe(true);
    }

    expect(isDatabaseErrorCode('DATABASE_WORKER_FAILED')).toBe(false);
    expect(isDatabaseErrorCode('DATABASE_UNKNOWN')).toBe(false);
    expect(isDatabaseErrorCode(null)).toBe(false);
  });

  test('supports safe overrides and an in-process cause', () => {
    const cause = new Error('local diagnostic only');
    const error = new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Executor rejected the command before dispatch.',
      {
        cause,
        retryable: true,
        outcome: 'not-started',
        details: {
          executorSlot: 2,
          operation: 'open',
          saturated: false,
          sequence: null,
        },
      },
    );

    expect(error.cause).toBe(cause);
    expect(error.retryable).toBe(true);
    expect(error.outcome).toBe('not-started');
    expect(error.details).toEqual({
      executorSlot: 2,
      operation: 'open',
      saturated: false,
      sequence: null,
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });

  test('rejects unsafe retry and outcome combinations', () => {
    expect(() => new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Unsafe retry shape.',
      { retryable: true, outcome: 'unknown' },
    )).toThrow('unknown outcome cannot be retryable');

    expect(() => new DatabaseError(
      'DATABASE_OUTCOME_UNKNOWN',
      'Contradictory outcome.',
      { outcome: 'not-committed' },
    )).toThrow('must have an unknown outcome');

    expect(() => new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      'Contradictory retry policy.',
      { retryable: true, outcome: 'not-started' },
    )).toThrow('must be non-retryable with a not-started outcome');

    expect(() => new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      'Contradictory commit boundary.',
      { retryable: false, outcome: 'not-committed' },
    )).toThrow('must be non-retryable with a not-started outcome');
  });

  test('removes unsafe or non-scalar local details as one atomic set', () => {
    const details = {
      operation: 'query',
      nested: { secret: 'must-not-cross' },
    } as unknown as Record<string, string>;
    const error = new DatabaseError(
      'DATABASE_PROTOCOL_ERROR',
      'Invalid response.',
      { details },
    );

    expect(error.details).toEqual({});
  });

  test('uses a stable capacity fallback when an unsafe message is rejected', () => {
    const error = new DatabaseError(
      'DATABASE_CAPACITY_EXHAUSTED',
      'private\u0000capacity detail',
    );

    expect(error.message).toBe('Database permanent capacity is exhausted.');
    expect(error.retryable).toBe(false);
    expect(error.outcome).toBe('not-started');
  });
});

describe('database error serialization', () => {
  test('round-trips the safe contract without stack or cause', () => {
    const secret = 'secret-cause-value';
    const cause = new Error(secret);
    cause.stack = `private-stack:${secret}`;
    const original = new DatabaseError(
      'DATABASE_CONFLICT',
      'The database transaction conflicted.',
      {
        cause,
        details: {
          attempt: 2,
          operation: 'mutation',
          durable: false,
          expectedSequence: null,
        },
      },
    );

    const serialized = serializeDatabaseError(original);
    const encoded = JSON.stringify(serialized);

    expect(serialized).toEqual({
      kind: DATABASE_ERROR_ENVELOPE_KIND,
      version: DATABASE_ERROR_ENVELOPE_VERSION,
      code: 'DATABASE_CONFLICT',
      message: 'The database transaction conflicted.',
      retryable: true,
      outcome: 'not-committed',
      details: {
        attempt: 2,
        operation: 'mutation',
        durable: false,
        expectedSequence: null,
      },
    });
    expect(Object.keys(serialized).sort()).toEqual([
      'code',
      'details',
      'kind',
      'message',
      'outcome',
      'retryable',
      'version',
    ]);
    expect(Object.isFrozen(serialized)).toBe(true);
    expect(Object.isFrozen(serialized.details)).toBe(true);
    expect(encoded).not.toContain('stack');
    expect(encoded).not.toContain('cause');
    expect(encoded).not.toContain(secret);
    expect(isSerializedDatabaseError(serialized)).toBe(true);

    const restored = deserializeDatabaseError(structuredClone(serialized));
    expect(restored).toBeInstanceOf(DatabaseError);
    expect(restored.code).toBe(original.code);
    expect(restored.message).toBe(original.message);
    expect(restored.retryable).toBe(original.retryable);
    expect(restored.outcome).toBe(original.outcome);
    expect(restored.details).toEqual(original.details);
    expect(restored.cause).toBeUndefined();
    expect(restored.stack).not.toContain(secret);
  });

  test('normalizes unknown executor failures without reflecting private data', () => {
    const secret = 'file:///private/tenant.sqlite?token=do-not-copy';
    const unknown = new Error(secret, {
      cause: { sql: 'SELECT private_value FROM secrets' },
    });
    unknown.stack = `private-stack:${secret}`;

    const normalized = normalizeDatabaseError(unknown);
    const serialized = serializeDatabaseError(unknown);
    const encoded = JSON.stringify(serialized);

    expect(normalized.code).toBe('DATABASE_EXECUTOR_FAILED');
    expect(normalized.message).toBe('Database executor failed.');
    expect(normalized.retryable).toBe(false);
    expect(normalized.outcome).toBe('unknown');
    expect(normalized.details).toEqual({});
    expect(normalized.cause).toBeUndefined();
    expect(encoded).not.toContain(secret);
    expect(encoded).not.toContain('SELECT private_value');
    expect(encoded).not.toContain('private-stack');
  });

  test('fails closed when hostile thrown proxies trap error inspection', () => {
    const privateText = 'private proxy trap and SQL';
    const prototypeTrap = new Proxy({}, {
      getPrototypeOf() {
        throw new Error(privateText);
      },
    });
    const wrappedDatabaseError = new Proxy(new DatabaseError(
      'DATABASE_CONFLICT',
      'Safe original message.',
    ), {
      get(target, property, receiver) {
        if (property === 'code') throw new Error(privateText);
        return Reflect.get(target, property, receiver);
      },
    });

    for (const value of [prototypeTrap, wrappedDatabaseError]) {
      expect(() => isDatabaseError(value)).not.toThrow();
      const normalized = normalizeDatabaseError(value);
      const serialized = serializeDatabaseError(value);

      expect(normalized).toMatchObject({
        code: 'DATABASE_EXECUTOR_FAILED',
        message: 'Database executor failed.',
        retryable: false,
        outcome: 'unknown',
        details: {},
      });
      expect(JSON.stringify(serialized)).not.toContain(privateText);
    }
  });

  test('rejects unrecognized and malicious envelopes with a safe fallback', () => {
    const valid = serializeDatabaseError(new DatabaseError(
      'DATABASE_QUEUE_TIMEOUT',
      'Database request expired in the queue.',
      { details: { timeoutMs: 250 } },
    ));
    const privateText = 'private-stack-or-sql';
    const throwingProxy = new Proxy({}, {
      ownKeys() {
        throw new Error(privateText);
      },
    });
    const getterEnvelope = {
      ...valid,
      get message(): string {
        throw new Error(privateText);
      },
    };
    const cases: unknown[] = [
      null,
      'not-an-envelope',
      {},
      { ...valid, kind: 'zero.other-error' },
      { ...valid, version: 99 },
      { ...valid, code: 'DATABASE_WORKER_FAILED' },
      { ...valid, retryable: 'yes' },
      { ...valid, outcome: 'maybe' },
      { ...valid, retryable: true, outcome: 'unknown' },
      {
        ...valid,
        code: 'DATABASE_CAPACITY_EXHAUSTED',
        retryable: true,
        outcome: 'not-started',
      },
      {
        ...valid,
        code: 'DATABASE_CAPACITY_EXHAUSTED',
        retryable: false,
        outcome: 'not-committed',
      },
      { ...valid, details: [] },
      { ...valid, details: { nested: { privateText } } },
      { ...valid, details: { infinite: Number.POSITIVE_INFINITY } },
      { ...valid, stack: privateText },
      { ...valid, cause: new Error(privateText) },
      getterEnvelope,
      throwingProxy,
    ];

    for (const value of cases) {
      expect(isSerializedDatabaseError(value)).toBe(false);
      const error = deserializeDatabaseError(value);
      const serialized = serializeDatabaseError(error);
      const encoded = JSON.stringify(serialized);

      expect(error.code).toBe('DATABASE_PROTOCOL_ERROR');
      expect(error.message).toBe('Invalid database executor response.');
      expect(error.retryable).toBe(false);
      expect(error.outcome).toBe('unknown');
      expect(error.details).toEqual({});
      expect(error.cause).toBeUndefined();
      expect(encoded).not.toContain(privateText);
    }
  });

  test('enforces bounded scalar detail and message shapes', () => {
    const valid = baseEnvelope();
    const tooManyDetails = Object.fromEntries(
      Array.from(
        { length: DATABASE_ERROR_DETAILS_MAX_ENTRIES + 1 },
        (_, index) => [`field${index}`, index],
      ),
    );
    const invalidDetails: unknown[] = [
      { ['x'.repeat(DATABASE_ERROR_DETAIL_KEY_MAX_LENGTH + 1)]: true },
      { __proto__: null, constructor: 'unsafe' },
      { value: 'x'.repeat(DATABASE_ERROR_DETAIL_STRING_MAX_LENGTH + 1) },
      { malformed: '\ud800' },
      tooManyDetails,
    ];

    for (const details of invalidDetails) {
      expect(isSerializedDatabaseError({ ...valid, details })).toBe(false);
    }

    expect(isSerializedDatabaseError({ ...valid, message: '' })).toBe(false);
    expect(isSerializedDatabaseError({ ...valid, message: '\u0000hidden' })).toBe(false);
  });

  test('copies details so later caller mutation cannot alter the envelope', () => {
    const details: Record<string, string | number> = {
      operation: 'query',
      queueDepth: 3,
    };
    const error = new DatabaseError(
      'DATABASE_BACKPRESSURE',
      'Database executor is saturated.',
      { details },
    );
    details.operation = 'secret-after-construction';

    const envelope = serializeDatabaseError(error);
    details.queueDepth = 999;

    expect(error.details).toEqual({ operation: 'query', queueDepth: 3 });
    expect(envelope.details).toEqual({ operation: 'query', queueDepth: 3 });
  });
});

function baseEnvelope(): SerializedDatabaseError {
  return serializeDatabaseError(new DatabaseError(
    'DATABASE_BACKPRESSURE',
    'Database executor is saturated.',
  ));
}
