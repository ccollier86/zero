/**
 * clause-initials-model.ts
 *
 * Owns stable clause IDs, immutable ink projection and completion counting for
 * the compact initials composition. It does not assign legal meaning or store
 * contract data, and it never keys draft ownership by array position.
 */
import { hasSignaturePadInk, snapshotSignaturePadStrokes } from './signature-model';
import type { SignaturePadStroke } from './signature-pad.types';

/** Stable clause identity, independent of its display ordering. */
export interface SignatureClauseIdentity { readonly id: string }

/** One immutable drawing per stable clause ID. */
export type ClauseInitialsValue = Readonly<Record<string, readonly SignaturePadStroke[]>>;

const EMPTY_INK = Object.freeze([]) as readonly SignaturePadStroke[];

/** Reject ambiguous clause identities before creating pad state or native field names. */
export function validateSignatureClauseIds(clauses: readonly SignatureClauseIdentity[]): void {
  if (!Array.isArray(clauses)) throw new TypeError('Signature clauses must be an array.');
  const ids = new Set<string>();
  for (const clause of clauses) {
    if (!clause || typeof clause.id !== 'string' || clause.id.trim().length === 0 || ids.has(clause.id)) {
      throw new TypeError('Signature clauses require unique, nonempty IDs.');
    }
    ids.add(clause.id);
  }
}

/** Copy only current clauses; own-property checks support IDs such as __proto__ safely. */
export function projectClauseInitialsValue(
  clauses: readonly SignatureClauseIdentity[], value?: ClauseInitialsValue,
): ClauseInitialsValue {
  validateSignatureClauseIds(clauses);
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new TypeError('Clause initials must be keyed by clause ID.');
  }
  const projected: Record<string, readonly SignaturePadStroke[]> = Object.create(null);
  for (const { id } of clauses) {
    projected[id] = value && Object.hasOwn(value, id) ? snapshotSignaturePadStrokes(value[id]) : EMPTY_INK;
  }
  return Object.freeze(projected);
}

/** Count only actual ink for the currently displayed clauses, not stale or empty entries. */
export function countCompletedClauseInitials(clauses: readonly SignatureClauseIdentity[], value: ClauseInitialsValue): number {
  validateSignatureClauseIds(clauses);
  return clauses.reduce((count, { id }) => count + Number(Object.hasOwn(value, id) && hasSignaturePadInk(value[id])), 0);
}

/** Replace one current clause with a deep snapshot without retaining removed clause data. */
export function updateClauseInitialsValue(
  clauses: readonly SignatureClauseIdentity[], value: ClauseInitialsValue, id: string, strokes: readonly SignaturePadStroke[],
): ClauseInitialsValue {
  if (!clauses.some((clause) => clause.id === id)) throw new TypeError('Cannot update an unknown signature clause.');
  return projectClauseInitialsValue(clauses, Object.assign(Object.create(null), value, { [id]: strokes }));
}
