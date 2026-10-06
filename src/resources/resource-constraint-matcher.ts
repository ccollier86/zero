/**
 * Evaluates already admitted resource constraints against raw retained rows.
 * This policy-layer matcher shares exact array semantics with SQL/find and
 * preserves existing scalar/boolean behavior; it does not project client data.
 */
import { isDatabasePayloadProxy } from '../databases/database-operation-payload';
import { matchesStringArrayOverlap } from '../lib/string-array-overlap';
import type { ResourceDataConstraint, ResourcePolicyScalar } from './resource-policy-types';

/** Apply a top-level AND before any client field projection. */
export function matchesResourceDataConstraints(
  row: Record<string, unknown>,
  constraints: readonly ResourceDataConstraint[],
): boolean {
  if (!row || typeof row !== 'object' || isDatabasePayloadProxy(row)) return false;
  try { return constraints.every((constraint) => matchesConstraint(row, constraint)); }
  catch { return false; }
}

function matchesConstraint(row: Record<string, unknown>, constraint: ResourceDataConstraint): boolean {
  if (constraint.type === 'field') {
    const descriptor = Object.getOwnPropertyDescriptor(row, constraint.field);
    if (!descriptor || !('value' in descriptor)) return false;
    if (constraint.operator === 'arrayOverlaps') return matchesStringArrayOverlap(descriptor.value, constraint.value);
    if (constraint.operator === 'eq') return scalarEquals(descriptor.value, constraint.value);
    return false;
  }
  if (constraint.type === 'anyOf') return constraint.constraints.some((child) => matchesConstraint(row, child));
  if (constraint.type === 'allOf') return constraint.constraints.length > 0
    && constraint.constraints.every((child) => matchesConstraint(row, child));
  return false;
}

function scalarEquals(actual: unknown, expected: ResourcePolicyScalar): boolean {
  if (typeof expected === 'boolean') {
    return actual === expected || actual === (expected ? 1 : 0)
      || actual === (expected ? '1' : '0') || actual === String(expected);
  }
  return actual === expected;
}
