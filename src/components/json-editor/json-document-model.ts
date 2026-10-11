/** Pure bounded JSON admission, immutable edits, pointer formatting and RFC 6902 diffs. No DOM, transport or persistence. */
import type { JsonDocumentPath, JsonDocumentValue, JsonDocumentPatch } from './json-document.types';

export const JSON_DOCUMENT_LIMITS = Object.freeze({ depth: 64, nodes: 50_000, characters: 1_000_000, history: 100, visibleRows: 5_000 });
export const jsonOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
export const jsonContainer = (value: JsonDocumentValue): value is readonly JsonDocumentValue[] | { readonly [key: string]: JsonDocumentValue } => value !== null && typeof value === 'object';
export const jsonPathKey = (path: JsonDocumentPath) => JSON.stringify(path);
export const jsonPointer = (path: JsonDocumentPath) => path.map(key => '/' + String(key).replace(/~/gu, '~0').replace(/\//gu, '~1')).join('');
export const jsonDisplayPath = (root: string, path: JsonDocumentPath) => root + path.map(key => typeof key === 'number' ? `[${key}]`
  : /^[A-Za-z_$][\w$]*$/u.test(key) ? '.' + key : `[${JSON.stringify(key)}]`).join('');
const put = (object: Record<string, JsonDocumentValue>, key: string, value: JsonDocumentValue) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });

/** Clone only finite, dense, plain JSON without evaluating accessors or coercing unsupported values. */
export function cloneJsonDocument(input: unknown): JsonDocumentValue {
  const seen = new Set<object>(); let nodes = 0, characters = 0;
  function clone(value: unknown, depth: number): JsonDocumentValue {
    if (++nodes > JSON_DOCUMENT_LIMITS.nodes || depth > JSON_DOCUMENT_LIMITS.depth) throw new RangeError('JSON document exceeds the supported structural limit.');
    if (typeof value === 'string') { characters += value.length; if (characters > JSON_DOCUMENT_LIMITS.characters) throw new RangeError('JSON document exceeds the text limit.'); return value; }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError('Use a finite, acyclic JSON document.');
    const array = Array.isArray(value);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('JSON objects must be plain objects.');
    seen.add(value);
    try {
      if (array) {
        const result: JsonDocumentValue[] = [];
        if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('JSON arrays must be dense and have no extra properties.');
        for (let index = 0; index < value.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !('value' in descriptor)) throw new TypeError('JSON arrays must contain ordinary values.');
          result.push(clone(descriptor.value, depth + 1));
        }
        return result;
      }
      const result: Record<string, JsonDocumentValue> = {};
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError('JSON objects must contain enumerable data properties.');
        characters += key.length;
        if (characters > JSON_DOCUMENT_LIMITS.characters) throw new RangeError('JSON document exceeds the text limit.');
        put(result, key, clone(descriptor.value, depth + 1));
      }
      return result;
    } finally { seen.delete(value); }
  }
  return clone(input, 0);
}

export function equalJsonDocument(left: JsonDocumentValue, right: JsonDocumentValue): boolean {
  if (left === right) return true;
  if (!jsonContainer(left) || !jsonContainer(right) || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => jsonOwn(right, key) && equalJsonDocument((left as Record<string, JsonDocumentValue>)[key]!, (right as Record<string, JsonDocumentValue>)[key]!));
}

/** Read own properties only; prototype names are ordinary JSON keys, never prototype traversal. */
export function readJsonPath(document: JsonDocumentValue, path: JsonDocumentPath): JsonDocumentValue {
  let value = document;
  for (const key of path) {
    if (Array.isArray(value) && (typeof key !== 'number' || !Number.isInteger(key) || key < 0 || key >= value.length)) throw new Error('Invalid JSON array position.');
    if (!jsonContainer(value) || !jsonOwn(value, key)) throw new Error('This JSON entry no longer exists.');
    value = (value as Record<string | number, JsonDocumentValue>)[key]!;
  }
  return value;
}

export type JsonMutation = { kind: 'replace'; path: JsonDocumentPath; value: JsonDocumentValue }
  | { kind: 'rename'; path: JsonDocumentPath; name: string }
  | { kind: 'remove'; path: JsonDocumentPath }
  | { kind: 'add'; path: JsonDocumentPath; after?: string | number };
/** Apply a checked local edit to a detached document; never mutate the caller's document. */
export function mutateJsonDocument(document: JsonDocumentValue, mutation: JsonMutation): { value: JsonDocumentValue; path: JsonDocumentPath } {
  const copy = cloneJsonDocument(document), path = mutation.path;
  if (mutation.kind === 'replace' && !path.length) return { value: cloneJsonDocument(mutation.value), path };
  if (mutation.kind === 'add') {
    const container = readJsonPath(copy, path);
    if (!jsonContainer(container)) throw new Error('Add entries inside an object or array.');
    if (Array.isArray(container)) {
      const index = mutation.after === undefined ? container.length : Number(mutation.after) + 1;
      if (!Number.isInteger(index) || index < 0 || index > container.length) throw new Error('Invalid JSON array position.');
      container.splice(index, 0, null); return { value: copy, path: [...path, index] };
    }
    const object = container as Record<string, JsonDocumentValue>, entries = Object.entries(object);
    let name = 'key', number = 2; while (jsonOwn(object, name)) name = `key_${number++}`;
    for (const key of Object.keys(object)) delete object[key];
    let inserted = false;
    for (const [key, value] of entries) { put(object, key, value); if (key === mutation.after) { put(object, name, null); inserted = true; } }
    if (!inserted) put(object, name, null);
    return { value: copy, path: [...path, name] };
  }
  if (!path.length) throw new Error('The JSON root cannot be removed or renamed.');
  readJsonPath(copy, path);
  const parent = readJsonPath(copy, path.slice(0, -1)), key = path.at(-1)!;
  if (!jsonContainer(parent)) throw new Error('This JSON parent no longer exists.');
  if (mutation.kind === 'rename') {
    if (Array.isArray(parent)) throw new Error('Array positions cannot be renamed.');
    if (mutation.name !== key && jsonOwn(parent, mutation.name)) throw new Error('That key already exists here.');
    const object = parent as Record<string, JsonDocumentValue>, entries = Object.entries(object);
    for (const key of Object.keys(object)) delete object[key];
    for (const [name, value] of entries) put(object, name === key ? mutation.name : name, value);
    return { value: copy, path: [...path.slice(0, -1), mutation.name] };
  }
  if (mutation.kind === 'remove') {
    if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete (parent as Record<string, JsonDocumentValue>)[key];
  } else if (Array.isArray(parent)) parent[Number(key)] = cloneJsonDocument(mutation.value);
  else put(parent as Record<string, JsonDocumentValue>, String(key), cloneJsonDocument(mutation.value));
  return { value: copy, path };
}

/** Detached RFC 6902 operations; array removals stay index-correct and object renames may use move. */
export function diffJsonDocument(previous: JsonDocumentValue, next: JsonDocumentValue): JsonDocumentPatch[] {
  const result: JsonDocumentPatch[] = [];
  function diff(a: JsonDocumentValue, b: JsonDocumentValue, path: JsonDocumentPath) {
    if (equalJsonDocument(a, b)) return;
    if (jsonContainer(a) && jsonContainer(b) && !Array.isArray(a) && !Array.isArray(b)) {
      const old = a as Record<string, JsonDocumentValue>, now = b as Record<string, JsonDocumentValue>;
      const added = Object.keys(now).filter(key => !jsonOwn(old, key)), moved = new Set<string>();
      const byValue = new Map<string, string[]>();
      for (const name of added) { const signature = JSON.stringify(now[name]); const names = byValue.get(signature) ?? []; names.push(name); byValue.set(signature, names); }
      for (const key of Object.keys(old)) if (!jsonOwn(now, key)) {
        const name = byValue.get(JSON.stringify(old[key]))?.pop();
        if (name !== undefined) { moved.add(name); result.push({ op: 'move', from: jsonPointer([...path, key]), path: jsonPointer([...path, name]) }); }
        else result.push({ op: 'remove', path: jsonPointer([...path, key]) });
      }
      for (const key of Object.keys(now)) if (!moved.has(key)) {
        if (!jsonOwn(old, key)) result.push({ op: 'add', path: jsonPointer([...path, key]), value: cloneJsonDocument(now[key]) });
        else diff(old[key]!, now[key]!, [...path, key]);
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      let prefix = 0, suffix = 0;
      while (prefix < a.length && prefix < b.length && equalJsonDocument(a[prefix]!, b[prefix]!)) prefix++;
      while (suffix < a.length - prefix && suffix < b.length - prefix && equalJsonDocument(a[a.length - 1 - suffix]!, b[b.length - 1 - suffix]!)) suffix++;
      const oldLength = a.length - prefix - suffix, newLength = b.length - prefix - suffix, common = Math.min(oldLength, newLength);
      for (let i = 0; i < common; i++) diff(a[prefix + i]!, b[prefix + i]!, [...path, prefix + i]);
      for (let i = common; i < oldLength; i++) result.push({ op: 'remove', path: jsonPointer([...path, prefix + common]) });
      for (let i = common; i < newLength; i++) result.push({ op: 'add', path: jsonPointer([...path, prefix + i]), value: cloneJsonDocument(b[prefix + i]) });
      return;
    }
    result.push({ op: 'replace', path: jsonPointer(path), value: cloneJsonDocument(b) });
  }
  diff(previous, next, []); return result;
}
