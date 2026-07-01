'use client';

/**
 * use-launchboard-data.ts
 *
 * ReactiveDB-backed LaunchBoard data adapter. This hook owns collection reads,
 * mutations, relationship cleanup, and active row selection. UI components own
 * rendering only.
 */

import * as React from 'react';
import { useCollection, useStatus, type CollectionResult } from '@zero/framework/react';

import type {
  BoardInput,
  CardInput,
  CategoryInput,
  ColumnInput,
  LaunchBoard,
  LaunchCard,
  LaunchCategory,
  LaunchColumn,
} from './types';

export interface LaunchBoardData {
  categories: LaunchCategory[];
  boards: LaunchBoard[];
  columns: LaunchColumn[];
  cards: LaunchCard[];
  activeCategory: LaunchCategory | null;
  activeBoard: LaunchBoard | null;
  activeCategoryId: string | null;
  activeBoardId: string | null;
  activeColumns: LaunchColumn[];
  activeCards: LaunchCard[];
  boardsForActiveCategory: LaunchBoard[];
  boardCountByCategory: Record<string, number>;
  cardCountByBoard: Record<string, number>;
  cardCountByColumn: Record<string, number>;
  connected: boolean;
  canDeleteActiveCategory: boolean;
  canDeleteActiveBoard: boolean;
  canDeleteColumn: boolean;
  selectCategory: (categoryId: string) => void;
  selectBoard: (boardId: string) => void;
  createCategory: (input: CategoryInput) => LaunchCategory | null;
  updateCategory: (categoryId: string, input: CategoryInput) => boolean;
  deleteCategory: (categoryId: string) => boolean;
  createBoard: (categoryId: string, input: BoardInput) => LaunchBoard | null;
  updateBoard: (boardId: string, input: BoardInput) => boolean;
  duplicateBoard: (boardId: string) => LaunchBoard | null;
  deleteBoard: (boardId: string) => boolean;
  createColumn: (boardId: string, input: ColumnInput) => LaunchColumn | null;
  updateColumn: (columnId: string, input: ColumnInput) => boolean;
  deleteColumn: (columnId: string) => boolean;
  createCard: (boardId: string, input: CardInput) => LaunchCard | null;
  updateCard: (cardId: string, input: CardInput) => boolean;
  deleteCard: (cardId: string) => boolean;
  moveCard: (move: { orderedColumnItemIds: Record<string, string[]> }) => void;
}

const DEFAULT_COLUMNS = [
  { title: 'Backlog', accent: 'bg-blue-500' },
  { title: 'In Progress', accent: 'bg-amber-500' },
  { title: 'Done', accent: 'bg-emerald-500' },
] as const;

function createId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function bySortOrder<T extends { sort_order: number }>(a: T, b: T): number {
  return a.sort_order - b.sort_order;
}

function normalizeOptionalText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRequiredText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function namesMatch(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function reindexRows<T extends { sort_order: number }>(
  rows: T[],
  update: (row: T, order: number) => void,
): void {
  rows.sort(bySortOrder).forEach((row, index) => {
    if (row.sort_order !== index) update(row, index);
  });
}

function useSortedCollection<T extends { sort_order: number } & Record<string, unknown>>(
  table: string,
): CollectionResult<T> & { sorted: T[] } {
  const collection = useCollection<T>(table);
  const sorted = React.useMemo(() => [...collection.data].sort(bySortOrder), [collection.data]);

  return { ...collection, sorted };
}

/** Return all LaunchBoard rows and mutations through Zero ReactiveDB. */
export function useLaunchBoardData(): LaunchBoardData {
  const categoriesCollection = useSortedCollection<LaunchCategory>('launch_categories');
  const boardsCollection = useSortedCollection<LaunchBoard>('launch_boards');
  const columnsCollection = useSortedCollection<LaunchColumn>('launch_columns');
  const cardsCollection = useSortedCollection<LaunchCard>('launch_cards');
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

  const boardCountByCategory = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const board of boards) counts[board.category_id] = (counts[board.category_id] ?? 0) + 1;
    return counts;
  }, [boards]);

  const cardCountByBoard = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const card of cards) counts[card.board_id] = (counts[card.board_id] ?? 0) + 1;
    return counts;
  }, [cards]);

  const cardCountByColumn = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const card of cards) counts[card.column_id] = (counts[card.column_id] ?? 0) + 1;
    return counts;
  }, [cards]);

  const selectCategory = React.useCallback((categoryId: string) => {
    setSelectedCategoryId(categoryId);
    const firstBoard = boards
      .filter((board) => board.category_id === categoryId)
      .sort(bySortOrder)[0] ?? null;
    setSelectedBoardId(firstBoard?.board_id ?? null);
  }, [boards]);

  const selectBoard = React.useCallback((boardId: string) => {
    const board = boards.find((item) => item.board_id === boardId);
    if (board) setSelectedCategoryId(board.category_id);
    setSelectedBoardId(boardId);
  }, [boards]);

  const createCategory = React.useCallback((input: CategoryInput) => {
    const name = normalizeRequiredText(input.name);
    if (!name) return null;
    if (categories.some((category) => namesMatch(category.name, name))) return null;

    const category: LaunchCategory = {
      category_id: createId('category'),
      name,
      description: normalizeOptionalText(input.description),
      color: input.color,
      sort_order: categories.length,
    };

    categoriesCollection.insert(category);
    setSelectedCategoryId(category.category_id);
    setSelectedBoardId(null);
    return category;
  }, [categories, categoriesCollection]);

  const updateCategory = React.useCallback((categoryId: string, input: CategoryInput) => {
    const name = normalizeRequiredText(input.name);
    if (!name || !categoriesCollection.byId[categoryId]) return false;
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
    if (categories.length <= 1) return false;
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
      ? boards
          .filter((board) => board.category_id === nextCategory.category_id)
          .sort(bySortOrder)[0] ?? null
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
  }, [boards, boardsCollection, cards, cardsCollection, categories, categoriesCollection, columns, columnsCollection]);

  const createBoard = React.useCallback((categoryId: string, input: BoardInput) => {
    const name = normalizeRequiredText(input.name);
    const category = categories.find((item) => item.category_id === categoryId);
    if (!name || !category) return null;

    const categoryBoards = boards.filter((board) => board.category_id === categoryId);
    const board: LaunchBoard = {
      board_id: createId('board'),
      category_id: category.category_id,
      name,
      description: normalizeOptionalText(input.description),
      sort_order: categoryBoards.length,
    };

    boardsCollection.insert(board);
    DEFAULT_COLUMNS.forEach((column, index) => {
      columnsCollection.insert({
        column_id: createId('column'),
        board_id: board.board_id,
        title: column.title,
        accent: column.accent,
        sort_order: index,
      });
    });
    setSelectedCategoryId(category.category_id);
    setSelectedBoardId(board.board_id);
    return board;
  }, [boards, boardsCollection, categories, columnsCollection]);

  const updateBoard = React.useCallback((boardId: string, input: BoardInput) => {
    const name = normalizeRequiredText(input.name);
    if (!name || !boardsCollection.byId[boardId]) return false;

    boardsCollection.update(boardId, {
      name,
      description: normalizeOptionalText(input.description),
    });
    return true;
  }, [boardsCollection]);

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
  }, [boards, boardsCollection, cards, cardsCollection, columns, columnsCollection]);

  const deleteBoard = React.useCallback((boardId: string) => {
    const board = boards.find((item) => item.board_id === boardId);
    if (!board) return false;

    const boardColumns = columns.filter((column) => column.board_id === boardId);
    const remainingBoards = boards.filter((item) => item.board_id !== boardId);
    const nextBoard = remainingBoards
      .filter((item) => item.category_id === board.category_id)
      .sort(bySortOrder)[0] ?? null;

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
  }, [boards, boardsCollection, cards, cardsCollection, columns, columnsCollection]);

  const createColumn = React.useCallback((boardId: string, input: ColumnInput) => {
    const title = normalizeRequiredText(input.title);
    const board = boards.find((item) => item.board_id === boardId);
    if (!title || !board) return null;

    const boardColumns = columns.filter((column) => column.board_id === boardId);
    const column: LaunchColumn = {
      column_id: createId('column'),
      board_id: board.board_id,
      title,
      accent: input.accent,
      sort_order: boardColumns.length,
    };

    columnsCollection.insert(column);
    return column;
  }, [boards, columns, columnsCollection]);

  const updateColumn = React.useCallback((columnId: string, input: ColumnInput) => {
    const title = normalizeRequiredText(input.title);
    if (!title || !columnsCollection.byId[columnId]) return false;

    columnsCollection.update(columnId, {
      title,
      accent: input.accent,
    });
    return true;
  }, [columnsCollection]);

  const deleteColumn = React.useCallback((columnId: string) => {
    const column = columns.find((item) => item.column_id === columnId);
    if (!column) return false;

    const boardColumns = columns.filter((item) => item.board_id === column.board_id);
    if (boardColumns.length <= 1) return false;
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

  const createCard = React.useCallback((boardId: string, input: CardInput) => {
    const title = normalizeRequiredText(input.title);
    const board = boards.find((item) => item.board_id === boardId);
    const column = columns.find(
      (item) => item.column_id === input.column_id && item.board_id === boardId,
    );
    if (!title || !board || !column) return null;

    const columnCards = cards.filter((card) => card.column_id === column.column_id);
    const card: LaunchCard = {
      card_id: createId('card'),
      board_id: board.board_id,
      column_id: column.column_id,
      title,
      description: normalizeOptionalText(input.description),
      priority: input.priority,
      sort_order: columnCards.length,
    };

    cardsCollection.insert(card);
    return card;
  }, [boards, cards, cardsCollection, columns]);

  const updateCard = React.useCallback((cardId: string, input: CardInput) => {
    const title = normalizeRequiredText(input.title);
    const card = cards.find((item) => item.card_id === cardId);
    if (!title || !card) return false;

    const targetColumn = columns.find(
      (column) => column.column_id === input.column_id && column.board_id === card.board_id,
    );
    if (!targetColumn) return false;
    const movedColumn = targetColumn.column_id !== card.column_id;

    cardsCollection.update(card.card_id, {
      column_id: targetColumn.column_id,
      title,
      description: normalizeOptionalText(input.description),
      priority: input.priority,
      sort_order: movedColumn
        ? cards.filter((item) => item.column_id === targetColumn.column_id && item.card_id !== card.card_id).length
        : card.sort_order,
    });
    return true;
  }, [cards, cardsCollection, columns]);

  const deleteCard = React.useCallback((cardId: string) => {
    const card = cards.find((item) => item.card_id === cardId);
    if (!card) return false;

    cardsCollection.remove(card.card_id);
    reindexRows(
      cards.filter((item) => item.column_id === card.column_id && item.card_id !== card.card_id),
      (row, order) => cardsCollection.update(row.card_id, { sort_order: order }),
    );
    return true;
  }, [cards, cardsCollection]);

  const moveCard = React.useCallback((move: { orderedColumnItemIds: Record<string, string[]> }) => {
    for (const [columnId, itemIds] of Object.entries(move.orderedColumnItemIds)) {
      const column = columnsCollection.byId[columnId];
      if (!column) continue;

      itemIds.forEach((cardId, index) => {
        const card = cardsCollection.byId[cardId];
        if (!card) return;
        cardsCollection.update(card.card_id, {
          board_id: column.board_id,
          column_id: column.column_id,
          sort_order: index,
        });
      });
    }
  }, [cardsCollection, columnsCollection]);

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
    connected,
    canDeleteActiveCategory: categories.length > 1,
    canDeleteActiveBoard: Boolean(activeBoard),
    canDeleteColumn: activeColumns.length > 1,
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
    createCard,
    updateCard,
    deleteCard,
    moveCard,
  };
}
