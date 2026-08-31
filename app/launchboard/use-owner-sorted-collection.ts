'use client';

/**
 * use-owner-sorted-collection.ts
 *
 * Owner-scoped ReactiveDB collection adapter for LaunchBoard. This hook owns
 * collection subscription sorting/filtering only; mutations live separately.
 */

import * as React from 'react';
import {
  useCollection,
  type CollectionResult,
} from '@zero/framework/react';

import { bySortOrder } from './launchboard-data-utils';

/** Return an owner-filtered, sort_order-sorted collection view. */
export function useOwnerSortedCollection<
  T extends { owner_id: string; sort_order: number } & Record<string, unknown>,
>(table: string, ownerId: string | null): CollectionResult<T> & { sorted: T[] } {
  const collection = useCollection<T>(table);
  const sorted = React.useMemo(
    () =>
      ownerId
        ? collection.data
            .filter((row) => row.owner_id === ownerId)
            .sort(bySortOrder)
        : [],
    [collection.data, ownerId],
  );

  return { ...collection, sorted };
}
