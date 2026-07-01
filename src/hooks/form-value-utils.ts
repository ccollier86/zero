/**
 * form-value-utils.ts
 *
 * Owns small value helpers used by Zero form hooks. This file compares
 * JSON-like form values only; it does not manage React state, validation, or
 * persistence.
 */

/** Return true when two form values should be treated as unchanged. */
export function areFormValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;

  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date
      && right instanceof Date
      && left.getTime() === right.getTime();
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;

    return left.every((value, index) => areFormValuesEqual(value, right[index]));
  }

  if (isPlainRecord(left) || isPlainRecord(right)) {
    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;

    return leftKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(right, key)
      && areFormValuesEqual(left[key], right[key])
    );
  }

  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
