/**
 * workflow-expression.ts
 *
 * Owns Zero's serializable workflow expression AST, builders, validation, and
 * side-effect-free evaluator. New graphs never compile or evaluate JavaScript
 * source strings.
 */

import type { WorkflowJsonValue } from './workflow-ir';
import { WORKFLOW_GRAPH_LIMITS } from './workflow-ir';
import { WorkflowError } from './workflow-error';
import { serializeWorkflowRuntimeJson, MAX_WORKFLOW_RUNTIME_JSON_BYTES } from './workflow-runtime-json';

const MAX_EXPRESSION_LITERAL_DEPTH = 64;

export type WorkflowReferenceScope =
  | 'input'
  | 'previous'
  | 'memory'
  | 'output'
  | 'item'
  | 'itemIndex';

export interface WorkflowLiteralExpression {
  type: 'literal';
  value: WorkflowJsonValue;
}

export interface WorkflowReferenceExpression {
  type: 'ref';
  scope: WorkflowReferenceScope;
  /** Required only when reading a specifically named node output. */
  node?: string;
  path: readonly string[];
}

export type WorkflowComparisonOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';

export interface WorkflowComparisonExpression {
  type: 'compare';
  op: WorkflowComparisonOperator;
  left: WorkflowExpression;
  right: WorkflowExpression;
}

export interface WorkflowLogicalExpression {
  type: 'logical';
  op: 'and' | 'or';
  values: readonly WorkflowExpression[];
}

export interface WorkflowNotExpression {
  type: 'not';
  value: WorkflowExpression;
}

export interface WorkflowExistsExpression {
  type: 'exists';
  value: WorkflowExpression;
}

export interface WorkflowIncludesExpression {
  type: 'includes';
  collection: WorkflowExpression;
  value: WorkflowExpression;
}

/** Construct a JSON object from independently evaluated bindings. Missing fields fail rather than disappear. */
export interface WorkflowObjectExpression {
  type: 'object';
  fields: Readonly<Record<string, WorkflowExpression>>;
}

/** Construct a dense JSON array from independently evaluated bindings. */
export interface WorkflowArrayExpression {
  type: 'array';
  items: readonly WorkflowExpression[];
}

/** Safe expression nodes accepted by code, database, API, and visual editors. */
export type WorkflowExpression =
  | WorkflowLiteralExpression
  | WorkflowReferenceExpression
  | WorkflowComparisonExpression
  | WorkflowLogicalExpression
  | WorkflowNotExpression
  | WorkflowExistsExpression
  | WorkflowIncludesExpression
  | WorkflowObjectExpression
  | WorkflowArrayExpression;

export type WorkflowExpressionInput = WorkflowExpression | WorkflowJsonValue;

export interface WorkflowExpressionContext {
  input?: unknown;
  previous?: unknown;
  memory?: unknown;
  outputs?: Readonly<Record<string, unknown>>;
  item?: unknown;
  itemIndex?: number;
}

/** Ergonomic, closure-free expression builders for code-authored workflows. */
export const expr = Object.freeze({
  object: (fields: Readonly<Record<string, WorkflowExpressionInput>>): WorkflowExpression => {
    if (!isRecord(fields)) fail('Object bindings require a fields map');
    assertExpressionObject(fields);
    return { type: 'object', fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => {
      assertPathPart(key);
      return [key, asExpression(value)];
    })) };
  },
  array: (items: readonly WorkflowExpressionInput[]): WorkflowExpression => {
    if (!Array.isArray(items)) fail('Array bindings require an items array');
    assertExpressionArray(items);
    return { type: 'array', items: items.map(asExpression) };
  },
  literal: (value: WorkflowJsonValue): WorkflowExpression => literal(value),
  input: (path?: string | readonly string[]): WorkflowExpression => ref('input', path),
  previous: (path?: string | readonly string[]): WorkflowExpression => ref('previous', path),
  memory: (path?: string | readonly string[]): WorkflowExpression => ref('memory', path),
  output: (node: string, path?: string | readonly string[]): WorkflowExpression => ({
    type: 'ref', scope: 'output', node, path: normalizePath(path),
  }),
  item: (path?: string | readonly string[]): WorkflowExpression => ref('item', path),
  itemIndex: (): WorkflowExpression => ref('itemIndex'),
  eq: (left: WorkflowExpressionInput, right: WorkflowExpressionInput) => compare('eq', left, right),
  ne: (left: WorkflowExpressionInput, right: WorkflowExpressionInput) => compare('ne', left, right),
  gt: (left: WorkflowExpressionInput, right: WorkflowExpressionInput) => compare('gt', left, right),
  gte: (left: WorkflowExpressionInput, right: WorkflowExpressionInput) => compare('gte', left, right),
  lt: (left: WorkflowExpressionInput, right: WorkflowExpressionInput) => compare('lt', left, right),
  lte: (left: WorkflowExpressionInput, right: WorkflowExpressionInput) => compare('lte', left, right),
  and: (...values: WorkflowExpressionInput[]): WorkflowExpression => logical('and', values),
  or: (...values: WorkflowExpressionInput[]): WorkflowExpression => logical('or', values),
  not: (value: WorkflowExpressionInput): WorkflowExpression => ({ type: 'not', value: asExpression(value) }),
  exists: (value: WorkflowExpressionInput): WorkflowExpression => ({ type: 'exists', value: asExpression(value) }),
  includes: (collection: WorkflowExpressionInput, value: WorkflowExpressionInput): WorkflowExpression => ({
    type: 'includes', collection: asExpression(collection), value: asExpression(value),
  }),
});

/** Return true only for an object carrying a recognized expression tag. */
export function isWorkflowExpression(value: unknown): value is WorkflowExpression {
  if (!isRecord(value)) return false;
  const tag = Object.getOwnPropertyDescriptor(value, 'type');
  return Boolean(tag && 'value' in tag && typeof tag.value === 'string'
    && ['literal', 'ref', 'compare', 'logical', 'not', 'exists', 'includes', 'object', 'array'].includes(tag.value));
}

/** Validate expression shape, depth, size, reference paths, and JSON literals. */
export function validateWorkflowExpression(expression: unknown): asserts expression is WorkflowExpression {
  let count = 0;
  const visit = (value: unknown, depth: number): void => {
    count += 1;
    if (count > WORKFLOW_GRAPH_LIMITS.maxExpressionNodes) fail('Expression is too large');
    if (depth > WORKFLOW_GRAPH_LIMITS.maxExpressionDepth) fail('Expression is too deeply nested');
    if (!isRecord(value)) fail('Expression node must be an object');
    assertExpressionObject(value);
    switch (value.type) {
      case 'object':
        assertKeys(value, ['type', 'fields']);
        if (!isRecord(value.fields)) fail('Object bindings require a fields map');
        assertExpressionObject(value.fields);
        for (const [key, child] of Object.entries(value.fields)) {
          assertPathPart(key);
          visit(child, depth + 1);
        }
        return;
      case 'array':
        assertKeys(value, ['type', 'items']);
        if (!Array.isArray(value.items)) fail('Array bindings require an items array');
        assertExpressionArray(value.items);
        for (const child of value.items) visit(child, depth + 1);
        return;
      case 'literal':
        assertKeys(value, ['type', 'value']);
        assertJson(value.value, new Set());
        return;
      case 'ref':
        assertKeys(value, ['type', 'scope', 'node', 'path']);
        if (!['input', 'previous', 'memory', 'output', 'item', 'itemIndex']
          .includes(String(value.scope))) fail('Expression reference scope is invalid');
        if (!Array.isArray(value.path)) fail('Expression reference path must be an array');
        if (value.path.length > WORKFLOW_GRAPH_LIMITS.maxExpressionPathSegments) {
          fail('Expression reference path has too many segments');
        }
        for (const part of value.path) assertPathPart(part);
        if (value.scope === 'output') {
          if (typeof value.node !== 'string'
            || !value.node.trim()
            || value.node !== value.node.trim()
            || value.node.length > WORKFLOW_GRAPH_LIMITS.maxIdLength
            || !/^[A-Za-z0-9@][A-Za-z0-9@/._:-]*$/.test(value.node)) {
            fail('Output expressions require a node id');
          }
        } else if (value.node !== undefined) {
          fail('Only output expressions may name a node');
        }
        return;
      case 'compare':
        assertKeys(value, ['type', 'op', 'left', 'right']);
        if (!['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(String(value.op))) {
          fail('Expression comparison operator is invalid');
        }
        visit(value.left, depth + 1);
        visit(value.right, depth + 1);
        return;
      case 'logical':
        assertKeys(value, ['type', 'op', 'values']);
        if (value.op !== 'and' && value.op !== 'or') fail('Expression logical operator is invalid');
        if (!Array.isArray(value.values) || value.values.length === 0) {
          fail('Logical expressions require at least one value');
        }
        assertExpressionArray(value.values);
        for (const child of value.values) visit(child, depth + 1);
        return;
      case 'not':
      case 'exists':
        assertKeys(value, ['type', 'value']);
        visit(value.value, depth + 1);
        return;
      case 'includes':
        assertKeys(value, ['type', 'collection', 'value']);
        visit(value.collection, depth + 1);
        visit(value.value, depth + 1);
        return;
      default:
        fail('Expression type is invalid');
    }
  };
  visit(expression, 0);
}

/** Evaluate a validated expression against immutable runtime values. */
export function evaluateWorkflowExpression(
  expression: WorkflowExpression,
  context: WorkflowExpressionContext,
): unknown {
  validateWorkflowExpression(expression);
  return evaluate(expression, context, '');
}

function evaluate(expression: WorkflowExpression, context: WorkflowExpressionContext, destination: string): unknown {
  switch (expression.type) {
    case 'object': {
      const result: Record<string, unknown> = {};
      let bytes = 2, fields = 0;
      for (const [key, child] of Object.entries(expression.fields)) {
        const path = `${destination}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        const text = mappedJson(evaluate(child, context, path), path, child);
        bytes += Buffer.byteLength(JSON.stringify(key), 'utf8') + Buffer.byteLength(text, 'utf8') + (fields++ ? 2 : 1);
        assertMappingBudget(bytes, path);
        result[key] = JSON.parse(text);
      }
      return result;
    }
    case 'array': {
      let bytes = 2;
      return expression.items.map((child, index) => {
        const path = `${destination}/${index}`, text = mappedJson(evaluate(child, context, path), path, child);
        bytes += Buffer.byteLength(text, 'utf8') + (index ? 1 : 0); assertMappingBudget(bytes, path);
        return JSON.parse(text);
      });
    }
    case 'literal': return expression.value;
    case 'ref': return readReference(expression, context);
    case 'compare': {
      const left = evaluate(expression.left, context, destination);
      const right = evaluate(expression.right, context, destination);
      if (expression.op === 'eq') return jsonEqual(left, right);
      if (expression.op === 'ne') return !jsonEqual(left, right);
      if (expression.op === 'gt') return comparable(left, right, (a, b) => a > b);
      if (expression.op === 'gte') return comparable(left, right, (a, b) => a >= b);
      if (expression.op === 'lt') return comparable(left, right, (a, b) => a < b);
      return comparable(left, right, (a, b) => a <= b);
    }
    case 'logical':
      return expression.op === 'and'
        ? expression.values.every((value) => Boolean(evaluate(value, context, destination)))
        : expression.values.some((value) => Boolean(evaluate(value, context, destination)));
    case 'not': return !Boolean(evaluate(expression.value, context, destination));
    case 'exists': return evaluate(expression.value, context, destination) !== undefined;
    case 'includes': {
      const collection = evaluate(expression.collection, context, destination);
      const sought = evaluate(expression.value, context, destination);
      if (Array.isArray(collection)) return collection.some((value) => jsonEqual(value, sought));
      if (typeof collection === 'string') return collection.includes(String(sought));
      if (isRecord(collection) && typeof sought === 'string') {
        return Object.prototype.hasOwnProperty.call(collection, sought);
      }
      return false;
    }
  }
}

function requireMappedValue(value: unknown, destination: string, source?: WorkflowExpression): unknown {
  if (value === undefined) {
    const reference = source?.type === 'ref' ? ` from ${source.scope}${source.node ? ':' + source.node : ''}:/${source.path.map(part => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}` : '';
    fail(`Workflow binding at "${destination}" resolves to a missing value${reference}; use explicit null when intended`);
  }
  return value;
}

function mappedJson(value: unknown, destination: string, source?: WorkflowExpression): string {
  return serializeWorkflowRuntimeJson(requireMappedValue(value, destination, source), { code: 'WORKFLOW_GRAPH_INVALID', label: `Workflow binding at "${destination || '/'}"` })!;
}

function assertMappingBudget(bytes: number, destination: string): void {
  if (bytes > MAX_WORKFLOW_RUNTIME_JSON_BYTES) throw new WorkflowError(`Workflow binding at "${destination}" exceeds its byte limit`, 'WORKFLOW_GRAPH_INVALID', 413);
}

function assertExpressionArray(value: readonly unknown[]): void {
  if (value.length > WORKFLOW_GRAPH_LIMITS.maxExpressionNodes) fail('Expression is too large');
  if (Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).some(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))) fail('Binding arrays cannot have named or symbol properties');
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('Binding arrays must be dense without accessors');
  }
}

function literal(value: WorkflowJsonValue): WorkflowExpression {
  assertJson(value, new Set());
  return { type: 'literal', value };
}

function ref(scope: WorkflowReferenceScope, path?: string | readonly string[]): WorkflowExpression {
  return { type: 'ref', scope, path: normalizePath(path) };
}

function compare(
  op: WorkflowComparisonOperator,
  left: WorkflowExpressionInput,
  right: WorkflowExpressionInput,
): WorkflowExpression {
  return { type: 'compare', op, left: asExpression(left), right: asExpression(right) };
}

function logical(op: 'and' | 'or', values: readonly WorkflowExpressionInput[]): WorkflowExpression {
  if (values.length === 0) fail('Logical expressions require at least one value');
  return { type: 'logical', op, values: values.map(asExpression) };
}

function asExpression(value: WorkflowExpressionInput): WorkflowExpression {
  return isWorkflowExpression(value) ? value : literal(value);
}

function normalizePath(path?: string | readonly string[]): readonly string[] {
  const parts = path === undefined || path === ''
    ? []
    : typeof path === 'string' ? path.split('.') : [...path];
  if (parts.length > WORKFLOW_GRAPH_LIMITS.maxExpressionPathSegments) {
    fail('Expression reference path has too many segments');
  }
  for (const part of parts) assertPathPart(part);
  return parts;
}

function assertPathPart(value: unknown): asserts value is string {
  if (typeof value !== 'string'
    || !value
    || value.length > WORKFLOW_GRAPH_LIMITS.maxExpressionPathSegmentLength
    || ['__proto__', 'prototype', 'constructor'].includes(value)) {
    fail('Expression reference path contains an invalid segment');
  }
}

function readReference(refValue: WorkflowReferenceExpression, context: WorkflowExpressionContext): unknown {
  let value: unknown;
  if (refValue.scope === 'input') value = context.input;
  else if (refValue.scope === 'previous') value = context.previous;
  else if (refValue.scope === 'memory') value = context.memory;
  else if (refValue.scope === 'item') value = context.item;
  else if (refValue.scope === 'itemIndex') value = context.itemIndex;
  else {
    const outputs = context.outputs;
    value = outputs ? ownValue(outputs, refValue.node!) : undefined;
  }
  for (const part of refValue.path) {
    if (value === null || typeof value !== 'object') return undefined;
    value = ownValue(value, part);
  }
  return value;
}

function ownValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) fail('Workflow references cannot invoke property accessors');
  return descriptor.value;
}

function comparable(
  left: unknown,
  right: unknown,
  compareValues: (left: number | string, right: number | string) => boolean,
): boolean {
  if (typeof left === 'number' && typeof right === 'number') return compareValues(left, right);
  if (typeof left === 'string' && typeof right === 'string') return compareValues(left, right);
  return false;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function assertJson(value: unknown, seen: Set<object>, depth = 0): void {
  if (depth > MAX_EXPRESSION_LITERAL_DEPTH) fail('Expression literal is too deeply nested');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Expression literals must contain finite numbers');
    return;
  }
  if (typeof value !== 'object') fail('Expression literals must be JSON-safe');
  if (seen.has(value)) fail('Expression literals must not contain cycles');
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('Expression literals cannot contain symbol properties');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        fail('Expression literal arrays must not be sparse');
      }
      assertJson(descriptor.value, seen, depth + 1);
    }
    const extra = Object.getOwnPropertyNames(value)
      .find((key) => key !== 'length' && !/^\d+$/.test(key));
    if (extra) fail('Expression literal arrays cannot contain named properties');
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('Expression literals must use plain JSON objects');
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      assertPathPart(key);
      if (!descriptor.enumerable || !('value' in descriptor)) {
        fail('Expression literals cannot contain hidden or accessor properties');
      }
      assertJson(descriptor.value, seen, depth + 1);
    }
  }
  seen.delete(value);
}

function assertExpressionObject(value: Record<string, unknown>): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('Expression nodes must use plain objects');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('Expression nodes cannot contain symbol properties');
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('Expression nodes cannot contain hidden or accessor properties');
    }
  }
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) fail(`Expression property "${unknown}" is not supported`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string): never {
  throw new WorkflowError(message, 'WORKFLOW_GRAPH_INVALID', 422);
}
