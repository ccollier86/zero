/**
 * Keeps combined caller/policy read budgets identical on SQL and Fabric.
 * Consumes only detached compiled predicates; it never parses request text,
 * evaluates authority or performs persistence operations.
 */
import {
  DATABASE_FIND_MAX_FILTERS,
  DATABASE_FIND_MAX_PARAMETERS,
  type DatabaseFindFilter,
  type DatabaseFindInput,
} from '../databases/database-operation-contracts';
import { cloneDatabaseSerializableValue } from '../databases/database-operation-payload';
import type { ResourceDataConstraint } from './resource-policy-types';
import type { ResourceQueryError } from './resource-query';

/** Count every admitted policy field/group node, including nested OR/AND groups. */
export function resourceConstraintNodeCount(constraints: readonly ResourceDataConstraint[]): number {
  return constraints.reduce((sum, constraint) => sum + 1
    + (constraint.type === 'field' ? 0 : resourceConstraintNodeCount(constraint.constraints)), 0);
}

/** Count actor bind costs using the same exact-equality/array-overlap contract as SQL. */
export function resourceFindQueryBudget(filters: readonly DatabaseFindFilter[]): { nodes: number; parameters: number } {
  const state = { nodes: 0, parameters: 2 };
  const visit = (filter: DatabaseFindFilter) => {
    state.nodes++;
    if (filter.type !== 'field') { filter.filters.forEach(visit); return; }
    if (filter.operator === 'arrayOverlaps' || filter.operator === 'in') {
      state.parameters += (filter.value as readonly unknown[]).filter(value => value !== null).length;
    } else if ((filter.operator === 'eq' || filter.operator === 'ne') && filter.value === null) {
      return;
    } else {
      state.parameters += filter.match === 'exact' ? typeof filter.value === 'boolean' ? 6 : 2 : 1;
    }
  };
  filters.forEach(visit);
  return state;
}

/** Reject excessive caller+policy combinations consistently before either executor is reached. */
export function validateResourceReadQueryBudget(nodes: number, parameters: number): ResourceQueryError | null {
  if (nodes > DATABASE_FIND_MAX_FILTERS || parameters > DATABASE_FIND_MAX_PARAMETERS) {
    return { status: 400, error: 'Combined resource query and policy predicate limit exceeded.' };
  }
  return null;
}

/** Admit the complete equivalent actor request, not individual policy/query fragments. */
export function validateResourceFindEnvelope(table: string, input: DatabaseFindInput): ResourceQueryError | null {
  try {
    // CRUD actor reads explicitly request strong consistency. Reserve that
    // complete envelope on either data plane, including table and transport
    // fields, so query/policy fragments cannot separately bypass its budget.
    cloneDatabaseSerializableValue({ type: 'find', table, ...input, consistency: { mode: 'strong' } });
    return null;
  } catch {
    return { status: 400, error: 'Resource query payload exceeds canonical database bounds or contains non-canonical values.' };
  }
}
