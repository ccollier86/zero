/**
 * master-detail-selection.ts
 *
 * Resolves schema-aware row selection for master-detail views. This file owns
 * pure selection math only; it does not render React components or subscribe to
 * backend data.
 */

import type { Row } from '../../sync/types';
import { requireRowPrimaryKey } from '../data-table/row-identity';

export interface MasterDetailSelection<T extends Row> {
  selectedId: string | null;
  selectedItem: T | null;
  selectedIndex: number;
}

/**
 * Resolve the selected row from an optional requested ID.
 *
 * Missing primary keys throw through `requireRowPrimaryKey` so callers do not
 * silently render a broken detail view.
 */
export function resolveMasterDetailSelection<T extends Row>(
  rows: readonly T[],
  primaryKey: string,
  requestedId: string | null | undefined,
  autoSelectFirst = true,
): MasterDetailSelection<T> {
  if (rows.length === 0) {
    return {
      selectedId: null,
      selectedItem: null,
      selectedIndex: -1,
    };
  }

  const rowIds = rows.map((row) => requireRowPrimaryKey(row, primaryKey));
  const requested = requestedId ?? null;
  const resolvedId = requested && rowIds.includes(requested)
    ? requested
    : autoSelectFirst
      ? rowIds[0]!
      : null;

  if (!resolvedId) {
    return {
      selectedId: null,
      selectedItem: null,
      selectedIndex: -1,
    };
  }

  const selectedIndex = rowIds.indexOf(resolvedId);

  return {
    selectedId: resolvedId,
    selectedItem: rows[selectedIndex] ?? null,
    selectedIndex,
  };
}
