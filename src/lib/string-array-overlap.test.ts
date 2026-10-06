import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import {
  matchesStringArrayOverlap,
  STRING_ARRAY_OVERLAP_MAX_PERMITTED_VALUES,
  STRING_ARRAY_OVERLAP_MAX_RETAINED_BYTES,
  STRING_ARRAY_OVERLAP_MAX_RETAINED_VALUES,
  STRING_ARRAY_OVERLAP_MAX_VALUE_BYTES,
  validateStringArrayOverlapValues,
} from './string-array-overlap';
import { buildStringArrayOverlapSql } from './string-array-overlap-sql';

describe('exact string-array overlap', () => {
  test('detaches policy strings, preserves duplicates and literal empty/NUL values', () => {
    const values = ['group_A', '', 'x\0tail', '😀', 'group_A'];
    const result = validateStringArrayOverlapValues(values);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected valid policy');
    expect(result.value).toEqual(values);
    expect(Object.isFrozen(result.value)).toBe(true);
    values[0] = 'mutated';
    expect(result.value[0]).toBe('group_A');
    expect(validateStringArrayOverlapValues([])).toEqual({ ok: true, value: [] });
  });

  test('rejects non-string, exotic, accessor and proxy arrays without callbacks', () => {
    let callbacks = 0;
    const getter = ['group_A'];
    Object.defineProperty(getter, '0', {
      enumerable: true,
      get() { callbacks += 1; return 'group_A'; },
    });
    const proxy = new Proxy(['group_A'], {
      get() { callbacks += 1; return 'group_A'; },
      ownKeys() { callbacks += 1; return ['0', 'length']; },
    });
    const revoked = Proxy.revocable(['group_A'], {});
    revoked.revoke();
    const extended = Object.assign(['group_A'], { extra: true });
    const symbol = ['group_A'];
    Object.defineProperty(symbol, Symbol('extra'), { value: true });
    const invalid = [
      null, undefined, {}, '[]', [1], [true], [null], [['group_A']],
      ['group_A', 1], new Array(1), getter, proxy, revoked.proxy,
      extended, symbol, ['\ud800'], ['\udc00'],
    ];
    for (const value of invalid) {
      expect(validateStringArrayOverlapValues(value).ok).toBe(false);
      expect(matchesStringArrayOverlap(value, ['group_A'])).toBe(false);
    }
    expect(callbacks).toBe(0);
  });

  test('enforces exact item and UTF-8 byte boundaries without leaking values', () => {
    expect(validateStringArrayOverlapValues(Array(STRING_ARRAY_OVERLAP_MAX_PERMITTED_VALUES).fill('x')).ok)
      .toBe(true);
    expect(validateStringArrayOverlapValues(Array(STRING_ARRAY_OVERLAP_MAX_PERMITTED_VALUES + 1).fill('private')))
      .toEqual({ ok: false, kind: 'limit', error: 'String-array overlap item limit exceeded.' });
    expect(validateStringArrayOverlapValues(['x'.repeat(STRING_ARRAY_OVERLAP_MAX_VALUE_BYTES)]).ok)
      .toBe(true);
    expect(validateStringArrayOverlapValues(['é'.repeat(512)]).ok).toBe(true);
    expect(validateStringArrayOverlapValues(['é'.repeat(513)]).ok).toBe(false);
    expect(validateStringArrayOverlapValues(['😀'.repeat(256)]).ok).toBe(true);
    expect(validateStringArrayOverlapValues(['😀'.repeat(257)]).ok).toBe(false);
  });

  test('has SQL/memory parity across shapes, casing, escapes, NUL and Unicode', () => {
    const rows: unknown[] = [
      undefined, null, false, 1, {}, [], ['group_B'], ['group_A'], ['group_A', 'group_A'],
      ['group_A', 1], ['group_A', null], ['group_A', true], ['group_A', ['nested']],
      ['group_A_extra'], ['GROUP_A'], ['', 'group_A'], ['0', 'true'],
      ['quote"slash\\'], ['line\nfeed'], ['x\0tail'], ['x'],
      ['group_A', '\ud800'], ['group_A', 'x\0\udc00'],
      ['group_A', 'Nڀ'], ['Nڀ'], ['😀', 'café'], ['café'],
      '[', 'no', '{}', 'null', 'true', '1', '"group_A"',
      '["group_A", {"nested":"x"}]', '["group_A", ["x"]]',
      '["group_A", "\\ud800"]', '["group_A", "x\\u0000\\udc00"]',
      '["\\u0067roup_A"]', '["x\\u0000tail"]',
    ];
    const allowed = ['group_A', '', 'quote"slash\\', 'line\nfeed', 'x\0tail', '😀', 'café', 'Nڀ'];
    for (const row of rows) assertSqlParity(row, allowed);
    for (const row of rows) assertSqlParity(row, []);
    assertSqlParity(['x'], ['x\0tail']);
    assertSqlParity(['x\0tail'], ['x']);
    assertSqlParity(['café'], ['café']);
    assertSqlParity(['group_A'], ['group']);
    assertSqlParity(['1'], ['0']);
  });

  test('validates all UTF-8 widths at exact boundaries including after NUL', () => {
    const values = [
      '\u0000', '\u0001', '\u001f', '\u007f', '\u0080', '\u07ff', '\u0800',
      '\ud7ff', '\ue000', '\uffff', '\u{10000}', '\u{10ffff}', 'Nڀ',
    ];
    for (const value of values) {
      assertSqlParity([value], [value]);
      assertSqlParity(['group_A', `\0${value}`], ['group_A']);
    }
  });

  test('bounds retained arrays and both raw/canonical JSON encoded bytes', () => {
    assertSqlParity(Array(STRING_ARRAY_OVERLAP_MAX_RETAINED_VALUES).fill('group_A'), ['group_A']);
    assertSqlParity(Array(STRING_ARRAY_OVERLAP_MAX_RETAINED_VALUES + 1).fill('group_A'), ['group_A']);
    assertSqlParity(['group_A', 'x'.repeat(1025)], ['group_A']);
    // Control bytes count after JSON escaping too, not just decoded UTF-8 size.
    const escaped = ['group_A', ...Array(11).fill('\0'.repeat(1024))];
    expect(new TextEncoder().encode(JSON.stringify(escaped)).byteLength)
      .toBeGreaterThan(STRING_ARRAY_OVERLAP_MAX_RETAINED_BYTES);
    assertSqlParity(escaped, ['group_A']);
    const minimal = '["group_A"]';
    const atBoundary = minimal + ' '.repeat(STRING_ARRAY_OVERLAP_MAX_RETAINED_BYTES - minimal.length);
    assertSqlParity(atBoundary, ['group_A']);
    expect(matchesStringArrayOverlap(atBoundary, ['group_A'])).toBe(true);
    assertSqlParity(atBoundary + ' ', ['group_A']);
    expect(matchesStringArrayOverlap(atBoundary + ' ', ['group_A'])).toBe(false);
  });

  test('guards arbitrary SQLite invalid UTF-8 before accepting another valid element', () => {
    const db = new Database(':memory:');
    try {
      db.run('CREATE TABLE rows (value TEXT)');
      const params: string[] = [];
      const sql = buildStringArrayOverlapSql('"value"', ['group_A'], params);
      // Build invalid TEXT bytes only in this synthetic database; normal JS
      // values cannot produce these byte encodings.
      const badBytes = ['80', 'C080', 'C2', 'EDA080', 'EDB080', 'F4908080', 'F5808080'];
      for (const hex of badBytes) {
        db.run('DELETE FROM rows');
        db.run(`INSERT INTO rows VALUES (CAST(x'5B2267726F75705F41222C22${hex}225D' AS TEXT))`);
        expect(db.query(`SELECT ${sql} AS allowed FROM rows`).get(...params))
          .toEqual({ allowed: 0 });
      }
    } finally { db.close(); }
  });

  test('quotes no supplied values into SQL and returns each row once', () => {
    const db = new Database(':memory:');
    try {
      db.run('CREATE TABLE rows (value TEXT COLLATE NOCASE)');
      const value = "x') OR 1=1 --";
      db.query('INSERT INTO rows VALUES (?)').run(JSON.stringify([value, value]));
      db.query('INSERT INTO rows VALUES (?)').run(JSON.stringify([value.toUpperCase()]));
      const params: string[] = [];
      const sql = buildStringArrayOverlapSql('"value"', [value, value], params);
      expect(params).toEqual([value, value]);
      expect(sql).not.toContain(value);
      expect(db.query(`SELECT count(*) AS count FROM rows WHERE ${sql}`).get(...params))
        .toEqual({ count: 1 });
      expect(buildStringArrayOverlapSql('"value"', [], params)).toBe('0');
      expect(() => buildStringArrayOverlapSql('"value"', [1] as unknown as string[], params))
        .toThrow('Invalid string-array overlap values.');
    } finally { db.close(); }
  });
});

function assertSqlParity(row: unknown, allowed: readonly string[]): void {
  const db = new Database(':memory:');
  try {
    // A `value` column deliberately exercises JSON iterator-name shadowing.
    db.run('CREATE TABLE rows (value ANY COLLATE NOCASE)');
    const stored = row === undefined ? null
      : typeof row === 'object' && row !== null ? JSON.stringify(row)
        : typeof row === 'boolean' ? Number(row) : row;
    db.query('INSERT INTO rows VALUES (?)').run(stored as string | number | null);
    const params: string[] = [];
    const sql = buildStringArrayOverlapSql('"value"', allowed, params);
    const result = db.query(`SELECT ${sql} AS allowed FROM rows`).get(...params) as { allowed: number };
    expect(result.allowed, `row=${JSON.stringify(row)} allowed=${JSON.stringify(allowed)}`)
      .toBe(Number(matchesStringArrayOverlap(row, allowed)));
    if (Array.isArray(row)) {
      expect(result.allowed).toBe(Number(matchesStringArrayOverlap(JSON.stringify(row), allowed)));
    }
  } finally { db.close(); }
}
