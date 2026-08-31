'use client';

/**
 * use-launchboard-data.ts
 *
 * Composes owner-scoped ReactiveDB reads, derived LaunchBoard state, and
 * mutation commands. Collection sorting and write commands live in focused
 * helper hooks so this file remains the data composition boundary.
 */

import * as React from 'react';
import {
  useCurrentUser,
  useStatus,
} from '@zero/framework/react';

import {
  countBy,
} from './launchboard-data-utils';
import type { LaunchBoardData } from './launchboard-data-types';
import type {
  LaunchBoard,
  LaunchCard,
  LaunchCategory,
  LaunchColumn,
} from './types';
import { useLaunchBoardMutations } from './use-launchboard-mutations';
import { useOwnerSortedCollection } from './use-owner-sorted-collection';

export type { LaunchBoardData } from './launchboard-data-types';

/** Return all LaunchBoard rows and mutations through Zero ReactiveDB. */
export function useLaunchBoardData(): LaunchBoardData {
  const currentUser = useCurrentUser();
  const ownerId = currentUser?.userId ?? null;
  const categoriesCollection = useOwnerSortedCollection<LaunchCategory>('launch_categories', ownerId);
  const boardsCollection = useOwnerSortedCollection<LaunchBoard>('launch_boards', ownerId);
  const columnsCollection = useOwnerSortedCollection<LaunchColumn>('launch_columns', ownerId);
  const cardsCollection = useOwnerSortedCollection<LaunchCard>('launch_cards', ownerId);
  const { connected } = useStatus();

  const categories = categoriesCollection.sorted;
  const boards = boardsCollection.sorted;
  const columns = columnsCollection.sorted;
  const cards = cardsCollection.sorted;

  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string | null>(null);
  const [selectedBoardId, setSelectedBoardId] = React.useState<string | null>(null);

  const activeCategory = React.useMemo(
    () => categories.find((category) => category.category_id === selectedCategoryId) ?? categories[0] ?? null,
    [categories, selectedCategoryId],
  );

  const boardsForActiveCategory = React.useMemo(
    () =>
      activeCategory
        ? boards.filter((board) => board.category_id === activeCategory.category_id)
        : [],
    [activeCategory, boards],
  );

  const activeBoard = React.useMemo(
    () =>
      boardsForActiveCategory.find((board) => board.board_id === selectedBoardId)
        ?? boardsForActiveCategory[0]
        ?? null,
    [boardsForActiveCategory, selectedBoardId],
  );

  React.useEffect(() => {
    const nextCategoryId = activeCategory?.category_id ?? null;
    if (selectedCategoryId !== nextCategoryId) setSelectedCategoryId(nextCategoryId);
  }, [activeCategory?.category_id, selectedCategoryId]);

  React.useEffect(() => {
    const nextBoardId = activeBoard?.board_id ?? null;
    if (selectedBoardId !== nextBoardId) setSelectedBoardId(nextBoardId);
  }, [activeBoard?.board_id, selectedBoardId]);

  const activeColumns = React.useMemo(
    () =>
      activeBoard
        ? columns.filter((column) => column.board_id === activeBoard.board_id)
        : [],
    [activeBoard, columns],
  );

  const activeCards = React.useMemo(
    () =>
      activeBoard
        ? cards.filter((card) => card.board_id === activeBoard.board_id)
        : [],
    [activeBoard, cards],
  );

  const boardCountByCategory = React.useMemo(
    () => countBy(boards, (board) => board.category_id),
    [boards],
  );

  const cardCountByBoard = React.useMemo(
    () => countBy(cards, (card) => card.board_id),
    [cards],
  );

  const cardCountByColumn = React.useMemo(
    () => countBy(cards, (card) => card.column_id),
    [cards],
  );

  const mutations = useLaunchBoardMutations({
    ownerId,
    categories,
    boards,
    columns,
    cards,
    categoriesCollection,
    boardsCollection,
    columnsCollection,
    cardsCollection,
    setSelectedCategoryId,
    setSelectedBoardId,
  });

  return {
    categories,
    boards,
    columns,
    cards,
    activeCategory,
    activeBoard,
    activeCategoryId: activeCategory?.category_id ?? null,
    activeBoardId: activeBoard?.board_id ?? null,
    activeColumns,
    activeCards,
    boardsForActiveCategory,
    boardCountByCategory,
    cardCountByBoard,
    cardCountByColumn,
    connected: connected && Boolean(ownerId),
    canDeleteActiveCategory: Boolean(activeCategory),
    canDeleteActiveBoard: Boolean(activeBoard),
    canDeleteColumn: Boolean(activeBoard),
    ...mutations,
  };
}
