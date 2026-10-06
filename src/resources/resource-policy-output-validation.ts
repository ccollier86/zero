/**
 * Admits detached custom policy decisions and bounded constraint trees. This
 * policy-layer boundary reuses descriptor-safe payload inspection and the
 * shared string-array contract; it never queries storage or logs scope values.
 */
import {
  DATABASE_FIND_MAX_FILTER_DEPTH,
  DATABASE_FIND_MAX_FILTERS,
  DATABASE_FIND_MAX_PARAMETERS,
} from '../databases/database-operation-contracts';
import {
  assertExactDatabaseFields,
  cloneDatabaseSerializableValue,
  databaseOperationRecord,
  isDatabasePayloadProxy,
  isDatabaseTableName,
  safeDatabasePayloadDescriptors,
  safeDatabasePayloadOwnKeys,
} from '../databases/database-operation-payload';
import { validateStringArrayOverlapValues } from '../lib/string-array-overlap';
import type { ResourceDataConstraint, ResourcePolicyDecision } from './resource-policy-types';

/** Safe configuration error: messages describe the contract, never returned policy values. */
export class ResourcePolicyOutputError extends Error {
  readonly code = 'RESOURCE_POLICY_OUTPUT_INVALID';
  constructor(message = 'Resource policy returned invalid data constraints.') {
    super(message);
    this.name = 'ResourcePolicyOutputError';
  }
}

/** Validate, detach and freeze a top-level AND of exact policy predicates. */
export function normalizeResourceDataConstraints(value: unknown): ResourceDataConstraint[] {
  const state = { nodes: 0, parameters: 2 };
  try {
    const constraints = inspectArray(value, DATABASE_FIND_MAX_FILTERS)
      .map((entry) => inspectConstraint(entry, 0, state));
    try {
      // Apply the shared aggregate byte/node/depth budget, not merely a
      // per-scalar cap. Keep the already deeply frozen admitted tree; cloning
      // here validates portability without retaining a second mutable copy.
      cloneDatabaseSerializableValue(constraints);
    } catch {
      throw new ResourcePolicyOutputError('Resource policy constraint payload exceeds canonical database bounds.');
    }
    return Object.freeze(constraints) as unknown as ResourceDataConstraint[];
  } catch (cause) {
    if (cause instanceof ResourcePolicyOutputError) throw cause;
    throw new ResourcePolicyOutputError();
  }
}

/** Inspect an app callback's structured output without invoking authored property getters. */
export function inspectResourcePolicyOutput(value: unknown): ResourcePolicyDecision {
  try {
    const record = databaseOperationRecord(value);
    assertExactDatabaseFields(record, ['allowed', 'reason', 'status', 'message', 'constraints', 'stampedInput', 'metadata']);
    if (typeof record.allowed !== 'boolean'
      || record.reason !== undefined && typeof record.reason !== 'string'
      || record.message !== undefined && typeof record.message !== 'string'
      || record.status !== undefined && (!Number.isInteger(record.status) || (record.status as number) < 100 || (record.status as number) > 599)) {
      throw new ResourcePolicyOutputError('Resource policy returned an invalid decision.');
    }
    return {
      allowed: record.allowed,
      ...(record.reason === undefined ? {} : { reason: record.reason as string }),
      ...(record.status === undefined ? {} : { status: record.status as number }),
      ...(record.message === undefined ? {} : { message: record.message as string }),
      ...(record.constraints === undefined ? {} : { constraints: normalizeResourceDataConstraints(record.constraints) }),
      ...(record.stampedInput === undefined ? {} : { stampedInput: databaseOperationRecord(record.stampedInput) }),
      ...(record.metadata === undefined ? {} : { metadata: databaseOperationRecord(record.metadata) }),
    };
  } catch (cause) {
    if (cause instanceof ResourcePolicyOutputError) throw cause;
    throw new ResourcePolicyOutputError('Resource policy returned an invalid decision.');
  }
}

function inspectConstraint(
  value: unknown,
  depth: number,
  state: { nodes: number; parameters: number },
): ResourceDataConstraint {
  if (depth > DATABASE_FIND_MAX_FILTER_DEPTH || ++state.nodes > DATABASE_FIND_MAX_FILTERS) {
    throw new ResourcePolicyOutputError('Resource policy constraint nesting or node limit exceeded.');
  }
  const record = databaseOperationRecord(value);
  if (record.type === 'anyOf' || record.type === 'allOf') {
    assertExactDatabaseFields(record, ['type', 'constraints']);
    const entries = inspectArray(record.constraints, DATABASE_FIND_MAX_FILTERS);
    if (!entries.length) throw new ResourcePolicyOutputError('Resource policy returned an empty constraint group.');
    return Object.freeze({
      type: record.type,
      constraints: Object.freeze(entries.map((entry) => inspectConstraint(entry, depth + 1, state))),
    }) as unknown as ResourceDataConstraint;
  }
  if (record.type !== 'field') throw new ResourcePolicyOutputError('Resource policy returned an unsupported constraint type.');
  assertExactDatabaseFields(record, ['type', 'field', 'operator', 'value']);
  if (!isDatabaseTableName(record.field)) throw new ResourcePolicyOutputError('Resource policy constraint field is invalid.');
  if (record.operator === 'arrayOverlaps') {
    const values = validateStringArrayOverlapValues(record.value);
    if (!values.ok) throw new ResourcePolicyOutputError(values.error);
    state.parameters += values.value.length;
    assertParameterBudget(state.parameters);
    return Object.freeze({ type: 'field', field: record.field, operator: 'arrayOverlaps', value: values.value });
  }
  if (record.operator !== 'eq') throw new ResourcePolicyOutputError('Resource policy returned an unsupported constraint operator.');
  const scalar = record.value;
  if (typeof scalar !== 'string' && typeof scalar !== 'boolean'
    && !(typeof scalar === 'number' && Number.isFinite(scalar))) {
    throw new ResourcePolicyOutputError('Resource equality constraints require a finite scalar value.');
  }
  try {
    // Scalar policies must be portable to the same actor envelope as list
    // predicates: reject -0, malformed Unicode and oversized strings before
    // either SQL planning or an unconstrained OR branch can admit them.
    cloneDatabaseSerializableValue(scalar);
  } catch {
    throw new ResourcePolicyOutputError('Resource equality constraints require a bounded canonical scalar value.');
  }
  state.parameters += typeof scalar === 'boolean' ? 6 : 2;
  assertParameterBudget(state.parameters);
  return Object.freeze({ type: 'field', field: record.field, operator: 'eq', value: scalar });
}

function assertParameterBudget(parameters: number): void {
  if (parameters > DATABASE_FIND_MAX_PARAMETERS) {
    throw new ResourcePolicyOutputError('Resource policy constraint parameter limit exceeded.');
  }
}

function inspectArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || isDatabasePayloadProxy(value) || value.length > maximum) {
    throw new ResourcePolicyOutputError('Resource policy constraints require a bounded array.');
  }
  const descriptors = safeDatabasePayloadDescriptors(value), keys = safeDatabasePayloadOwnKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) {
    throw new ResourcePolicyOutputError('Resource policy constraint arrays must be dense and unextended.');
  }
  return Array.from({ length: value.length }, (_, index) => {
    const entry = descriptors[String(index)];
    if (!entry || !entry.enumerable || !('value' in entry)) {
      throw new ResourcePolicyOutputError('Resource policy constraint arrays must contain data elements.');
    }
    return entry.value;
  });
}
