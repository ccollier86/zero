/**
 * kv-size.ts
 *
 * Estimates KV value sizes for cache budgeting. This file owns approximate
 * sizing only; it does not enforce eviction, serialize checkpoints, or mutate
 * KV entries.
 */

const encoder = new TextEncoder();

/** Estimate the in-memory size of a KV value for budget-based eviction. */
export function estimateKvValueSize(value: unknown): number {
  if (value === null || value === undefined) return 0;

  switch (typeof value) {
    case 'boolean':
      return 4;
    case 'number':
      return 8;
    case 'bigint':
      return 8;
    case 'string':
      return encoder.encode(value).byteLength;
    case 'symbol':
    case 'function':
      return 0;
    case 'object':
      return estimateObjectSize(value);
  }

  return 0;
}

function estimateObjectSize(value: object): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;

  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}
