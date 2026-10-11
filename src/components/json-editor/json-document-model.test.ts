/** JSON admission, safe path mutation, source diagnostics and patch conformance; no DOM or service writes. */
import { expect, test } from 'bun:test';
import { cloneJsonDocument, diffJsonDocument, equalJsonDocument, jsonPointer, mutateJsonDocument, readJsonPath } from './json-document-model';
import { parseJsonDocument, tokenizeJsonDocument } from './json-document-source';
import type { JsonDocumentValue, JsonDocumentPatch } from './json-document.types';

test('plain JSON is detached; prototype-named keys remain data and accessors never execute', () => {
  const source = JSON.parse('{"__proto__":{"polluted":true},"constructor":3}');
  const copy = cloneJsonDocument(source);
  expect(copy).toEqual(source); expect(copy).not.toBe(source); expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  let reads = 0; const getter = Object.defineProperty({}, 'secret', { enumerable: true, get() { reads++; return 'no'; } });
  expect(() => cloneJsonDocument(getter)).toThrow(); expect(reads).toBe(0);
  expect(() => readJsonPath({}, ['__proto__'])).toThrow();
});

test('unsupported, cyclic, sparse, nonfinite and oversized documents are rejected', () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const invalid of [undefined, NaN, Infinity, 1n, new Date(), cyclic, [, 3], new Map(), { a: undefined }, 'x'.repeat(1_000_001)]) {
    expect(() => cloneJsonDocument(invalid)).toThrow();
  }
  expect(() => cloneJsonDocument({ ['x'.repeat(1_000_001)]: null })).toThrow();
});

test('immutable edits retain order, permit legal empty keys, reject duplicate renames and preserve caller values', () => {
  const original = { one: 1, two: 2 };
  expect(mutateJsonDocument(original, { kind: 'rename', path: ['one'], name: '' }).value).toEqual({ '': 1, two: 2 });
  expect(() => mutateJsonDocument(original, { kind: 'rename', path: ['one'], name: 'two' })).toThrow();
  expect(mutateJsonDocument(original, { kind: 'add', path: [], after: 'one' })).toEqual({ value: { one: 1, key: null, two: 2 }, path: ['key'] });
  expect(mutateJsonDocument([1, 2], { kind: 'add', path: [], after: 0 })).toEqual({ value: [1, null, 2], path: [1] });
  expect(mutateJsonDocument([1, 2], { kind: 'remove', path: [0] }).value).toEqual([2]);
  expect(() => mutateJsonDocument([1, 2], { kind: 'remove', path: ['length'] })).toThrow();
  expect(original).toEqual({ one: 1, two: 2 });
});

function apply(previous: JsonDocumentValue, patch: readonly JsonDocumentPatch[]): JsonDocumentValue {
  let value = cloneJsonDocument(previous);
  const path = (pointer: string): Array<string | number> => {
    const keys = pointer ? pointer.slice(1).split('/').map(key => key.replace(/~1/gu, '/').replace(/~0/gu, '~')) : [];
    let current = value; const result: Array<string | number> = [];
    for (const key of keys) { const part = Array.isArray(current) ? Number(key) : key; result.push(part);
      current = current !== null && typeof current === 'object' ? (current as Record<string | number, JsonDocumentValue>)[part]! : null; }
    return result;
  };
  const add = (target: Array<string | number>, item: JsonDocumentValue) => {
    if (!target.length) { value = cloneJsonDocument(item); return; }
    const parent = readJsonPath(value, target.slice(0, -1)), key = target.at(-1)!;
    if (Array.isArray(parent)) parent.splice(Number(key), 0, cloneJsonDocument(item));
    else Object.defineProperty(parent, key, { value: cloneJsonDocument(item), enumerable: true, writable: true, configurable: true });
  };
  for (const op of patch) {
    if (op.op === 'move') { const from = path(op.from), item = readJsonPath(value, from); value = mutateJsonDocument(value, { kind: 'remove', path: from }).value; add(path(op.path), item); }
    else if (op.op === 'remove') value = mutateJsonDocument(value, { kind: 'remove', path: path(op.path) }).value;
    else if (op.op === 'replace') value = mutateJsonDocument(value, { kind: 'replace', path: path(op.path), value: op.value }).value;
    else add(path(op.path), op.value);
  }
  return value;
}

test('patches reproduce targets for arrays, nested changes, escaped pointers, renames and root replacements', () => {
  const cases: Array<[JsonDocumentValue, JsonDocumentValue]> = [
    [[1, 2, 3], [1, 3]], [[1], [1, 2, 3]], [[1, 2, 3, 4], [1, 5, 4]],
    [{ a: { x: true }, z: 2 }, { b: { x: true }, z: 4 }],
    [{ 'a/b~c': 1 }, { '': 1 }], [{ one: [1, 2] }, null],
    [JSON.parse('{"__proto__":1}'), JSON.parse('{"constructor":1}')],
  ];
  for (const [previous, next] of cases) expect(apply(previous, diffJsonDocument(previous, next))).toEqual(next);
  expect(jsonPointer(['a/b', '~', ''])).toBe('/a~1b/~0/');
  expect(diffJsonDocument([1, 2, 3], [1, 3])).toEqual([{ op: 'remove', path: '/1' }]);
  const before = Object.fromEntries(Array.from({ length: 2500 }, (_, index) => [`old${index}`, index]));
  const after = Object.fromEntries(Array.from({ length: 2500 }, (_, index) => [`new${index}`, index]));
  expect(apply(before, diffJsonDocument(before, after))).toEqual(after);
  expect(equalJsonDocument({ a: 1 }, { a: 1 })).toBe(true);
});

test('strict source parsing supplies accurate diagnostics and rejects duplicate/nonfinite values', () => {
  const result = parseJsonDocument('{\n  "a": 1\n  "b": 2\n}');
  expect(result).toMatchObject({ ok: false, line: 3, column: 3, message: 'Missing comma between entries.' });
  for (const source of ['{"a":1,"a":2}', '1e999', '01', '{"a":1,}', '[1,]', '// comment', 'true false', '"\t"', '{x:1}']) expect(parseJsonDocument(source).ok).toBe(false);
  for (const source of ['null', '-1.5e+3', '{"a":"\\n","b":[true,false]}', '{"__proto__":{"x":1}}']) expect(parseJsonDocument(source).ok).toBe(true);
  expect(tokenizeJsonDocument('{"x":"<script>"}').map(token => token.text).join('')).toBe('{"x":"<script>"}');
});
