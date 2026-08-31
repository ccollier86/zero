/**
 * launchboard-data-types.ts
 *
 * Shared LaunchBoard data adapter contracts. This file owns TypeScript shapes
 * only; hooks and mutation behavior live in separate files.
 */

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

/** ReactiveDB mutation commands exposed to LaunchBoard UI components. */
export interface LaunchBoardMutations {
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

/** Fully resolved LaunchBoard data state plus mutation commands. */
export interface LaunchBoardData extends LaunchBoardMutations {
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
}
