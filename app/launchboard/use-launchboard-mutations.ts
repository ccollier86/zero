'use client';

/**
 * use-launchboard-mutations.ts
 *
 * ReactiveDB-backed LaunchBoard mutation commands. This hook owns writes,
 * relationship cleanup, and active-row selection updates only.
 */

import * as React from 'react';
import type { CollectionResult } from '@zero/framework/react';

import {
  DEFAULT_COLUMNS,
  bySortOrder,
  createId,
  firstSorted,
  namesMatch,
  normalizeOptionalText,
  normalizeRequiredText,
  reindexRows,
} from './launchboard-data-utils';
import type { LaunchBoardMutations } from './launchboard-data-types';
import type {
  BoardInput,
  CategoryInput,
  ColumnInput,
  LaunchBoard,
  LaunchCard,
  LaunchCategory,
  LaunchColumn,
} from './types';
import { useLaunchBoardCardMutations } from './use-launchboard-card-mutations';

interface LaunchBoardMutationOptions {
  ownerId: string | null;
  categories: LaunchCategory[];
  boards: LaunchBoard[];
  columns: LaunchColumn[];
  cards: LaunchCard[];
  categoriesCollection: CollectionResult<LaunchCategory>;
  boardsCollection: CollectionResult<LaunchBoard>;
  columnsCollection: CollectionResult<LaunchColumn>;
  cardsCollection: CollectionResult<LaunchCard>;
  setSelectedCategoryId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedBoardId: React.Dispatch<React.SetStateAction<string | null>>;
}

/** Build stable LaunchBoard mutation commands around current ReactiveDB rows. */
export function useLaunchBoardMutations(options: LaunchBoardMutationOptions): LaunchBoardMutations {
  const {
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
  } = options;
  const cardMutations = useLaunchBoardCardMutations({
    ownerId,
    boards,
    columns,
    cards,
    cardsCollection,
  });

  const selectCategory = React.useCallback((categoryId: string) => {
    setSelectedCategoryId(categoryId);
    const firstBoard = firstSorted(boards.filter((board) => board.category_id === categoryId));
    setSelectedBoardId(firstBoard?.board_id ?? null);
  }, [boards, setSelectedBoardId, setSelectedCategoryId]);

  const selectBoard = React.useCallback((boardId: string) => {
    const board = boards.find((item) => item.board_id === boardId);
    if (board) setSelectedCategoryId(board.category_id);
    setSelectedBoardId(boardId);
  }, [boards, setSelectedBoardId, setSelectedCategoryId]);

  const createCategory = React.useCallback((input: CategoryInput) => {
    const name = normalizeRequiredText(input.name);
    if (!ownerId || !name) return null;
    if (categories.some((category) => namesMatch(category.name, name))) return null;

    const category: LaunchCategory = {
      category_id: createId('category'),
      owner_id: ownerId,
      name,
      description: normalizeOptionalText(input.description),
      color: input.color,
      sort_order: categories.length,
    };

    categoriesCollection.insert(category);
    setSelectedCategoryId(category.category_id);
    setSelectedBoardId(null);
    return category;
  }, [categories, categoriesCollection, ownerId, setSelectedBoardId, setSelectedCategoryId]);

  const updateCategory = React.useCallback((categoryId: string, input: CategoryInput) => {
    const name = normalizeRequiredText(input.name);
    if (!name || !categories.some((category) => category.category_id === categoryId)) return false;
    if (categories.some((category) => category.category_id !== categoryId && namesMatch(category.name, name))) {
      return false;
    }

    categoriesCollection.update(categoryId, {
      name,
      description: normalizeOptionalText(input.description),
      color: input.color,
    });
    return true;
  }, [categories, categoriesCollection]);

  const deleteCategory = React.useCallback((categoryId: string) => {
    const category = categories.find((item) => item.category_id === categoryId);
    if (!category) return false;

    const boardIds = new Set(
      boards.filter((board) => board.category_id === categoryId).map((board) => board.board_id),
    );
    const columnIds = new Set(
      columns.filter((column) => boardIds.has(column.board_id)).map((column) => column.column_id),
    );
    const remainingCategories = categories.filter((item) => item.category_id !== categoryId);
    const nextCategory = remainingCategories[0] ?? null;
    const nextBoard = nextCategory
      ? firstSorted(boards.filter((board) => board.category_id === nextCategory.category_id))
      : null;

    for (const card of cards) {
      if (boardIds.has(card.board_id)) cardsCollection.remove(card.card_id);
    }
    for (const column of columns) {
      if (columnIds.has(column.column_id)) columnsCollection.remove(column.column_id);
    }
    for (const board of boards) {
      if (boardIds.has(board.board_id)) boardsCollection.remove(board.board_id);
    }
    categoriesCollection.remove(category.category_id);
    reindexRows(remainingCategories, (row, order) => {
      categoriesCollection.update(row.category_id, { sort_order: order });
    });

    setSelectedCategoryId(nextCategory?.category_id ?? null);
    setSelectedBoardId(nextBoard?.board_id ?? null);
    return true;
  }, [
    boards,
    boardsCollection,
    cards,
    cardsCollection,
    categories,
    categoriesCollection,
    columns,
    columnsCollection,
    setSelectedBoardId,
    setSelectedCategoryId,
  ]);

  const createBoard = React.useCallback((categoryId: string, input: BoardInput) => {
    const name = normalizeRequiredText(input.name);
    const category = categories.find((item) => item.category_id === categoryId);
    if (!ownerId || !name || !category) return null;

    const categoryBoards = boards.filter((board) => board.category_id === categoryId);
    const board: LaunchBoard = {
      board_id: createId('board'),
      owner_id: ownerId,
      category_id: category.category_id,
      name,
      description: normalizeOptionalText(input.description),
      sort_order: categoryBoards.length,
    };

    boardsCollection.insert(board);
    DEFAULT_COLUMNS.forEach((column, index) => {
      columnsCollection.insert({
        column_id: createId('column'),
        owner_id: ownerId,
        board_id: board.board_id,
        title: column.title,
        accent: column.accent,
        sort_order: index,
      });
    });
    setSelectedCategoryId(category.category_id);
    setSelectedBoardId(board.board_id);
    return board;
  }, [boards, boardsCollection, categories, columnsCollection, ownerId, setSelectedBoardId, setSelectedCategoryId]);

  const updateBoard = React.useCallback((boardId: string, input: BoardInput) => {
    const name = normalizeRequiredText(input.name);
    if (!name || !boards.some((board) => board.board_id === boardId)) return false;

    boardsCollection.update(boardId, {
      name,
      description: normalizeOptionalText(input.description),
    });
    return true;
  }, [boards, boardsCollection]);

  const duplicateBoard = React.useCallback((boardId: string) => {
    const source = boards.find((board) => board.board_id === boardId);
    if (!source) return null;

    const nextBoardId = createId('board');
    const siblingCount = boards.filter((board) => board.category_id === source.category_id).length;
    const board: LaunchBoard = {
      ...source,
      board_id: nextBoardId,
      name: `${source.name} Copy`,
      sort_order: siblingCount,
    };
    const sourceColumns = columns
      .filter((column) => column.board_id === source.board_id)
      .sort(bySortOrder);
    const columnIdMap = new Map<string, string>();
    const duplicatedColumnIds: string[] = [];

    boardsCollection.insert(board);
    sourceColumns.forEach((column) => {
      const nextColumnId = createId('column');
      columnIdMap.set(column.column_id, nextColumnId);
      duplicatedColumnIds.push(nextColumnId);
      columnsCollection.insert({
        ...column,
        column_id: nextColumnId,
        board_id: nextBoardId,
      });
    });

    cards
      .filter((card) => card.board_id === source.board_id)
      .sort(bySortOrder)
      .forEach((card) => {
        cardsCollection.insert({
          ...card,
          card_id: createId('card'),
          board_id: nextBoardId,
          column_id: columnIdMap.get(card.column_id) ?? duplicatedColumnIds[0] ?? card.column_id,
        });
      });

    setSelectedCategoryId(source.category_id);
    setSelectedBoardId(nextBoardId);
    return board;
  }, [
    boards,
    boardsCollection,
    cards,
    cardsCollection,
    columns,
    columnsCollection,
    setSelectedBoardId,
    setSelectedCategoryId,
  ]);

  const deleteBoard = React.useCallback((boardId: string) => {
    const board = boards.find((item) => item.board_id === boardId);
    if (!board) return false;

    const boardColumns = columns.filter((column) => column.board_id === boardId);
    const remainingBoards = boards.filter((item) => item.board_id !== boardId);
    const nextBoard = firstSorted(
      remainingBoards.filter((item) => item.category_id === board.category_id),
    );

    for (const card of cards) {
      if (card.board_id === boardId) cardsCollection.remove(card.card_id);
    }
    for (const column of boardColumns) columnsCollection.remove(column.column_id);
    boardsCollection.remove(board.board_id);
    reindexRows(
      remainingBoards.filter((item) => item.category_id === board.category_id),
      (row, order) => boardsCollection.update(row.board_id, { sort_order: order }),
    );

    setSelectedBoardId(nextBoard?.board_id ?? null);
    if (nextBoard) setSelectedCategoryId(nextBoard.category_id);
    return true;
  }, [
    boards,
    boardsCollection,
    cards,
    cardsCollection,
    columns,
    columnsCollection,
    setSelectedBoardId,
    setSelectedCategoryId,
  ]);

  const createColumn = React.useCallback((boardId: string, input: ColumnInput) => {
    const title = normalizeRequiredText(input.title);
    const board = boards.find((item) => item.board_id === boardId);
    if (!ownerId || !title || !board) return null;

    const boardColumns = columns.filter((column) => column.board_id === boardId);
    const column: LaunchColumn = {
      column_id: createId('column'),
      owner_id: ownerId,
      board_id: board.board_id,
      title,
      accent: input.accent,
      sort_order: boardColumns.length,
    };

    columnsCollection.insert(column);
    return column;
  }, [boards, columns, columnsCollection, ownerId]);

  const updateColumn = React.useCallback((columnId: string, input: ColumnInput) => {
    const title = normalizeRequiredText(input.title);
    if (!title || !columns.some((column) => column.column_id === columnId)) return false;

    columnsCollection.update(columnId, {
      title,
      accent: input.accent,
    });
    return true;
  }, [columns, columnsCollection]);

  const deleteColumn = React.useCallback((columnId: string) => {
    const column = columns.find((item) => item.column_id === columnId);
    if (!column) return false;

    const boardColumns = columns.filter((item) => item.board_id === column.board_id);
    const remainingColumns = boardColumns.filter((item) => item.column_id !== columnId);

    for (const card of cards) {
      if (card.column_id === columnId) cardsCollection.remove(card.card_id);
    }
    columnsCollection.remove(column.column_id);
    reindexRows(remainingColumns, (row, order) => {
      columnsCollection.update(row.column_id, { sort_order: order });
    });
    return true;
  }, [cards, cardsCollection, columns, columnsCollection]);

  return {
    selectCategory,
    selectBoard,
    createCategory,
    updateCategory,
    deleteCategory,
    createBoard,
    updateBoard,
    duplicateBoard,
    deleteBoard,
    createColumn,
    updateColumn,
    deleteColumn,
    ...cardMutations,
  };
}
