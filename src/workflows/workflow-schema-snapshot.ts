/** JSON-safe TypeBox schema snapshots for durable workflow definitions. */

import {
  Kind,
  OptionalKind,
  ReadonlyKind,
  TransformKind,
  type TSchema,
} from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { WorkflowError } from './workflow-error';
import type { WorkflowJsonValue } from './workflow-json-value';

const KIND_FIELD = 'x-zero-typebox-kind';
const MAX_SCHEMA_DEPTH = 128;
const MAX_SCHEMA_MEMBERS = 100_000;
const SAFE_METADATA_SYMBOLS = new Set<symbol>([Kind, OptionalKind, ReadonlyKind]);
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

interface SnapshotBudget {
  members: number;
}

/**
 * Convert TypeBox or persisted JSON Schema into one durable representation.
 * TypeBox's runtime kind is retained as an explicit JSON extension; executable
 * transforms and all other non-data members fail closed.
 */
export function normalizeWorkflowSchemaSnapshot(schema: unknown): WorkflowJsonValue {
  const snapshot = normalize(schema, '$', new Set(), 0, { members: 0 });
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== 'object') {
    return invalid('Workflow schema must be a JSON object');
  }
  return snapshot;
}

/** Clone a durable schema and restore TypeBox runtime kind metadata. */
export function rehydrateWorkflowSchema(schema: unknown): TSchema {
  const snapshot = normalizeWorkflowSchemaSnapshot(schema);
  restoreKinds(snapshot, '$');
  return snapshot as TSchema;
}

/** Validate a value against either a TypeBox schema or its durable snapshot. */
export function validateWorkflowSchemaValue(schema: unknown, value: unknown): boolean {
  return Value.Check(rehydrateWorkflowSchema(schema), value);
}

function normalize(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  depth: number,
  budget: SnapshotBudget,
): WorkflowJsonValue {
  budget.members += 1;
  if (budget.members > MAX_SCHEMA_MEMBERS) return invalid('Workflow schema is too large');
  if (depth > MAX_SCHEMA_DEPTH) return invalid('Workflow schema is too deeply nested');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid(`${path} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') return invalid(`${path} contains a non-data value`);
  if (ancestors.has(value)) return invalid('Workflow schema cannot contain cycles');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result: WorkflowJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          return invalid('Workflow schema arrays cannot be sparse');
        }
        result.push(normalize(value[index], `${path}[${index}]`, ancestors, depth + 1, budget));
      }
      const extra = Object.getOwnPropertyNames(value)
        .find((key) => key !== 'length' && !/^\d+$/.test(key));
      if (extra) return invalid('Workflow schema arrays cannot have named properties');
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid(`${path} must be a plain object`);
    }
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.includes(TransformKind)) {
      return invalid('Workflow schemas cannot persist TypeBox transforms');
    }
    const unknownSymbol = symbols.find((symbol) => !SAFE_METADATA_SYMBOLS.has(symbol));
    if (unknownSymbol) return invalid(`${path} contains unsupported symbol metadata`);
    const unsafeSymbol = symbols.find((symbol) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, symbol);
      return !descriptor || !('value' in descriptor);
    });
    if (unsafeSymbol) return invalid(`${path} contains executable symbol metadata`);

    const result: Record<string, WorkflowJsonValue> = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      if (UNSAFE_KEYS.has(key)) return invalid(`${path}.${key} is unsafe`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) {
        return invalid(`${path}.${key} must be an enumerable data property`);
      }
      result[key] = normalize(
        descriptor.value,
        `${path}.${key}`,
        ancestors,
        depth + 1,
        budget,
      );
    }
    const kind = (value as TSchema)[Kind];
    if (kind !== undefined) {
      if (typeof kind !== 'string' || !kind) return invalid(`${path} has invalid TypeBox kind metadata`);
      const persisted = result[KIND_FIELD];
      if (persisted !== undefined && persisted !== kind) {
        return invalid(`${path} has conflicting TypeBox kind metadata`);
      }
      result[KIND_FIELD] = kind;
    } else if (result[KIND_FIELD] !== undefined
      && (typeof result[KIND_FIELD] !== 'string' || !result[KIND_FIELD])) {
      return invalid(`${path}.${KIND_FIELD} must be a non-empty string`);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function restoreKinds(value: WorkflowJsonValue, path: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => restoreKinds(child, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== KIND_FIELD) restoreKinds(child, `${path}.${key}`);
  }
  const explicit = value[KIND_FIELD];
  if (explicit !== undefined) delete value[KIND_FIELD];
  const kind = typeof explicit === 'string' ? explicit : inferKind(value);
  // JSON Schema contains structural containers such as `properties` and
  // `patternProperties`. They are data maps, not schemas in their own right,
  // and therefore must not receive TypeBox kind metadata.
  if (!kind) return;
  Object.defineProperty(value, Kind, { value: kind, enumerable: false });
}

function inferKind(schema: Record<string, WorkflowJsonValue>): string | null {
  if (typeof schema.$ref === 'string') return 'Ref';
  if ('const' in schema) return 'Literal';
  if (Array.isArray(schema.anyOf)) return 'Union';
  if (Array.isArray(schema.allOf)) return 'Intersect';
  if (schema.not && typeof schema.not === 'object') return 'Not';
  if (schema.type === 'object' && schema.patternProperties) return 'Record';
  if (schema.type === 'array' && Array.isArray(schema.items)) return 'Tuple';
  if (Object.keys(schema).length === 0) return 'Any';
  if (typeof schema.type !== 'string') return null;
  return ({
    array: 'Array', bigint: 'BigInt', boolean: 'Boolean', Constructor: 'Constructor',
    Date: 'Date', Function: 'Function', integer: 'Integer', Iterator: 'Iterator',
    AsyncIterator: 'AsyncIterator', null: 'Null', number: 'Number', object: 'Object',
    Promise: 'Promise', RegExp: 'RegExp', string: 'String', symbol: 'Symbol',
    Uint8Array: 'Uint8Array', undefined: 'Undefined', void: 'Void',
  } as Record<string, string>)[schema.type] ?? null;
}

function invalid(message: string): never {
  throw new WorkflowError(message, 'WORKFLOW_GRAPH_INVALID', 422);
}
