/** Pure, sequence-fenced progressive Data Studio projection; no authority or transport. */
import type { DataStudioRow, DataStudioRowPage } from './data-studio-client';

export interface DataStudioRowWindow {
  readonly rows: readonly DataStudioRow[];
  readonly page: DataStudioRowPage;
}

/** A continuation cannot be joined after the database snapshot changed. */
export class DataStudioWindowChangedError extends Error {
  constructor() {
    super('Records changed while loading. Refresh the results to continue.');
    this.name = 'DataStudioWindowChangedError';
  }
}

/** Append only contiguous, unique, same-snapshot rows; never silently skip/deduplicate. */
export function appendDataStudioRowPage(
  current: DataStudioRowWindow | null,
  page: DataStudioRowPage,
): DataStudioRowWindow {
  const expectedOffset = current?.page.nextOffset ?? 0;
  if (page.offset !== expectedOffset || (current && (
    current.page.nextOffset === null
    || !Number.isSafeInteger(page.readSequence)
    || page.readSequence !== current.page.readSequence
    || page.total !== current.page.total
  ))) throw new DataStudioWindowChangedError();
  const end = page.offset + page.rows.length;
  if (end > page.total || (page.nextOffset === null ? end !== page.total : page.nextOffset !== end)
    || (page.nextOffset !== null && page.rows.length === 0)) throw new DataStudioWindowChangedError();
  const seen = new Set(current?.rows.map(row => row.rowId));
  for (const row of page.rows) {
    if (seen.has(row.rowId)) throw new DataStudioWindowChangedError();
    seen.add(row.rowId);
  }
  return Object.freeze({ rows: Object.freeze([...(current?.rows ?? []), ...page.rows]), page });
}
