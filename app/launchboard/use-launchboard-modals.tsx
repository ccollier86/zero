'use client';

/**
 * use-launchboard-modals.tsx
 *
 * LaunchBoard modal workflows. This file owns dialog composition,
 * confirmations, and user-facing mutation feedback. Data persistence stays in
 * `use-launchboard-data.ts`.
 */

import * as React from 'react';
import { modals, toast } from '@zero/framework/react';

import {
  BoardForm,
  CardForm,
  CategoryForm,
  ColumnForm,
} from './forms';
import type { LaunchBoardData } from './use-launchboard-data';
import type {
  LaunchBoard,
  LaunchCard,
  LaunchCategory,
  LaunchColumn,
} from './types';

export interface LaunchBoardModalActions {
  openCreateCategory: () => void;
  openEditCategory: (category: LaunchCategory) => void;
  confirmDeleteCategory: (category: LaunchCategory, closeModalId?: string) => Promise<void>;
  openCreateBoard: (categoryId: string) => void;
  openEditBoard: (board: LaunchBoard) => void;
  duplicateBoard: (board: LaunchBoard) => void;
  confirmDeleteBoard: (board: LaunchBoard, closeModalId?: string) => Promise<void>;
  openCreateColumn: (boardId: string) => void;
  openEditColumn: (column: LaunchColumn) => void;
  confirmDeleteColumn: (column: LaunchColumn, closeModalId?: string) => Promise<void>;
  openCreateCard: (boardId: string, columnId?: string) => void;
  openEditCard: (card: LaunchCard) => void;
  confirmDeleteCard: (card: LaunchCard, closeModalId?: string) => Promise<void>;
}

/** Build modal actions around the current LaunchBoard data adapter. */
export function useLaunchBoardModals(data: LaunchBoardData): LaunchBoardModalActions {
  const confirmDeleteCategory = React.useCallback(async (
    category: LaunchCategory,
    closeModalId?: string,
  ) => {
    if (!data.canDeleteActiveCategory) {
      toast.error('Keep at least one category.');
      return;
    }

    const confirmed = await modals.confirm({
      title: 'Delete category?',
      description: `This deletes "${category.name}" and every board, column, and card inside it.`,
      confirmLabel: 'Delete category',
      variant: 'destructive',
      holdToConfirm: true,
    });
    if (!confirmed) return;

    if (!data.deleteCategory(category.category_id)) {
      toast.error('Category could not be deleted.');
      return;
    }
    if (closeModalId) modals.close(closeModalId);
    toast.success('Category deleted.');
  }, [data]);

  const confirmDeleteBoard = React.useCallback(async (
    board: LaunchBoard,
    closeModalId?: string,
  ) => {
    const confirmed = await modals.confirm({
      title: 'Delete board?',
      description: `This deletes "${board.name}" and every column and card inside it.`,
      confirmLabel: 'Delete board',
      variant: 'destructive',
      holdToConfirm: true,
    });
    if (!confirmed) return;

    if (!data.deleteBoard(board.board_id)) {
      toast.error('Board could not be deleted.');
      return;
    }
    if (closeModalId) modals.close(closeModalId);
    toast.success('Board deleted.');
  }, [data]);

  const confirmDeleteColumn = React.useCallback(async (
    column: LaunchColumn,
    closeModalId?: string,
  ) => {
    if (!data.canDeleteColumn) {
      toast.error('Keep at least one column on the board.');
      return;
    }

    const confirmed = await modals.confirm({
      title: 'Delete column?',
      description: `This deletes "${column.title}" and every card inside it.`,
      confirmLabel: 'Delete column',
      variant: 'destructive',
      holdToConfirm: true,
    });
    if (!confirmed) return;

    if (!data.deleteColumn(column.column_id)) {
      toast.error('Column could not be deleted.');
      return;
    }
    if (closeModalId) modals.close(closeModalId);
    toast.success('Column deleted.');
  }, [data]);

  const confirmDeleteCard = React.useCallback(async (
    card: LaunchCard,
    closeModalId?: string,
  ) => {
    const confirmed = await modals.confirm({
      title: 'Delete card?',
      description: `This deletes "${card.title}" from the active board.`,
      confirmLabel: 'Delete card',
      variant: 'destructive',
    });
    if (!confirmed) return;

    if (!data.deleteCard(card.card_id)) {
      toast.error('Card could not be deleted.');
      return;
    }
    if (closeModalId) modals.close(closeModalId);
    toast.success('Card deleted.');
  }, [data]);

  const openCreateCategory = React.useCallback(() => {
    let modalId = '';
    modalId = modals.open({
      title: 'Add category',
      size: 'md',
      content: (
        <CategoryForm
          onCancel={() => modals.close(modalId)}
          onSubmit={(input) => {
            const category = data.createCategory(input);
            if (!category) {
              toast.error('Use a unique category name.');
              return;
            }
            modals.close(modalId);
            toast.success('Category created.');
          }}
        />
      ),
    });
  }, [data]);

  const openEditCategory = React.useCallback((category: LaunchCategory) => {
    let modalId = '';
    modalId = modals.open({
      title: 'Edit category',
      size: 'md',
      content: (
        <CategoryForm
          category={category}
          onCancel={() => modals.close(modalId)}
          onDelete={data.canDeleteActiveCategory ? () => void confirmDeleteCategory(category, modalId) : undefined}
          onSubmit={(input) => {
            if (!data.updateCategory(category.category_id, input)) {
              toast.error('Category could not be updated.');
              return;
            }
            modals.close(modalId);
            toast.success('Category updated.');
          }}
        />
      ),
    });
  }, [confirmDeleteCategory, data]);

  const openCreateBoard = React.useCallback((categoryId: string) => {
    let modalId = '';
    modalId = modals.open({
      title: 'Add board',
      size: 'md',
      content: (
        <BoardForm
          onCancel={() => modals.close(modalId)}
          onSubmit={(input) => {
            const board = data.createBoard(categoryId, input);
            if (!board) {
              toast.error('Board could not be created.');
              return;
            }
            modals.close(modalId);
            toast.success('Board created.');
          }}
        />
      ),
    });
  }, [data]);

  const openEditBoard = React.useCallback((board: LaunchBoard) => {
    let modalId = '';
    modalId = modals.open({
      title: 'Edit board',
      size: 'md',
      content: (
        <BoardForm
          board={board}
          onCancel={() => modals.close(modalId)}
          onDelete={() => void confirmDeleteBoard(board, modalId)}
          onSubmit={(input) => {
            if (!data.updateBoard(board.board_id, input)) {
              toast.error('Board could not be updated.');
              return;
            }
            modals.close(modalId);
            toast.success('Board updated.');
          }}
        />
      ),
    });
  }, [confirmDeleteBoard, data]);

  const duplicateBoard = React.useCallback((board: LaunchBoard) => {
    const duplicate = data.duplicateBoard(board.board_id);
    if (!duplicate) {
      toast.error('Board could not be duplicated.');
      return;
    }
    toast.success('Board duplicated.');
  }, [data]);

  const openCreateColumn = React.useCallback((boardId: string) => {
    let modalId = '';
    modalId = modals.open({
      title: 'Add column',
      size: 'sm',
      content: (
        <ColumnForm
          onCancel={() => modals.close(modalId)}
          onSubmit={(input) => {
            const column = data.createColumn(boardId, input);
            if (!column) {
              toast.error('Column could not be created.');
              return;
            }
            modals.close(modalId);
            toast.success('Column created.');
          }}
        />
      ),
    });
  }, [data]);

  const openEditColumn = React.useCallback((column: LaunchColumn) => {
    let modalId = '';
    modalId = modals.open({
      title: 'Edit column',
      size: 'sm',
      content: (
        <ColumnForm
          column={column}
          onCancel={() => modals.close(modalId)}
          onDelete={data.canDeleteColumn ? () => void confirmDeleteColumn(column, modalId) : undefined}
          onSubmit={(input) => {
            if (!data.updateColumn(column.column_id, input)) {
              toast.error('Column could not be updated.');
              return;
            }
            modals.close(modalId);
            toast.success('Column updated.');
          }}
        />
      ),
    });
  }, [confirmDeleteColumn, data]);

  const openCreateCard = React.useCallback((boardId: string, columnId?: string) => {
    let modalId = '';
    modalId = modals.open({
      title: 'Add card',
      size: 'md',
      content: (
        <CardForm
          columns={data.activeColumns}
          defaultColumnId={columnId}
          onCancel={() => modals.close(modalId)}
          onSubmit={(input) => {
            const card = data.createCard(boardId, input);
            if (!card) {
              toast.error('Card could not be created.');
              return;
            }
            modals.close(modalId);
            toast.success('Card created.');
          }}
        />
      ),
    });
  }, [data]);

  const openEditCard = React.useCallback((card: LaunchCard) => {
    let modalId = '';
    modalId = modals.open({
      title: 'Edit card',
      size: 'md',
      content: (
        <CardForm
          card={card}
          columns={data.activeColumns}
          onCancel={() => modals.close(modalId)}
          onDelete={() => void confirmDeleteCard(card, modalId)}
          onSubmit={(input) => {
            if (!data.updateCard(card.card_id, input)) {
              toast.error('Card could not be updated.');
              return;
            }
            modals.close(modalId);
            toast.success('Card updated.');
          }}
        />
      ),
    });
  }, [confirmDeleteCard, data]);

  return {
    openCreateCategory,
    openEditCategory,
    confirmDeleteCategory,
    openCreateBoard,
    openEditBoard,
    duplicateBoard,
    confirmDeleteBoard,
    openCreateColumn,
    openEditColumn,
    confirmDeleteColumn,
    openCreateCard,
    openEditCard,
    confirmDeleteCard,
  };
}
