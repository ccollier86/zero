/** Strict parser for the single explicit byte-range shape supported by Storage. */

export interface StorageHttpByteRange {
  readonly start: number;
  readonly end: number;
}

/** Return null for every unsupported, malformed, reversed, or unsatisfied range. */
export function parseStorageHttpByteRange(
  header: string,
  size: number,
): StorageHttpByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(0|[1-9]\d*)-(?:(0|[1-9]\d*))?$/u.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? size - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || start >= size
    || end >= size) return null;
  return Object.freeze({ start, end });
}
