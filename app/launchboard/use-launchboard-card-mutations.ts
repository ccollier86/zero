'use client';

/**
 * use-launchboard-card-mutations.ts
 *
 * Card-specific LaunchBoard ReactiveDB commands. This file owns card create,
 * update, delete, and drag/drop persistence only.
 */

import * as React from 'react';
import type { CollectionResult } from '@zero/framework/react';

import {
  createId,
  normalizeOptionalText,
  normalizeRequiredText,
  reindexRows,
} from './launchboard-data-utils';
import type { LaunchBoardMutations } from './launchboard-data-types';
import type {
  CardInput,
  LaunchBoard,
  LaunchCard,
  LaunchColumn,
} from './types';

interface LaunchBoardCardMutationOptions {
  ownerId: string | null;
  boards: LaunchBoard[];
  columns: LaunchColumn[];
  cards: LaunchCard[];
  cardsCollection: CollectionResult<LaunchCard>;
}

type LaunchBoardCardMutations = Pick<
  LaunchBoardMutations,
  'createCard' | 'updateCard' | 'deleteCard' | 'moveCard'
>;

/** Build stable card mutation commands around current ReactiveDB rows. */
export function useLaunchBoardCardMutations(
  options: LaunchBoardCardMutationOptions,
): LaunchBoardCardMutations {
  const {
    ownerId,
    boards,
    columns,
    cards,
    cardsCollection,
  } = options;

  const createCard = React.useCallback((boardId: string, input: CardInput) => {
    const title = normalizeRequiredText(input.title);
    const board = boards.find((item) => item.board_id === boardId);
    const column = columns.find(
      (item) => item.column_id === input.column_id && item.board_id === boardId,
    );
    if (!ownerId || !title || !board || !column) return null;

    const columnCards = cards.filter((card) => card.column_id === column.column_id);
    const card: LaunchCard = {
      card_id: createId('card'),
      owner_id: ownerId,
      board_id: board.board_id,
      column_id: column.column_id,
      title,
      description: normalizeOptionalText(input.description),
      priority: input.priority,
      sort_order: columnCards.length,
    };

    cardsCollection.insert(card);
    return card;
  }, [boards, cards, cardsCollection, columns, ownerId]);

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
      const column = columns.find((item) => item.column_id === columnId);
      if (!column) continue;

      itemIds.forEach((cardId, index) => {
        const card = cards.find((item) => item.card_id === cardId);
        if (!card) return;
        cardsCollection.update(card.card_id, {
          board_id: column.board_id,
          column_id: column.column_id,
          sort_order: index,
        });
      });
    }
  }, [cards, cardsCollection, columns]);

  return {
    createCard,
    updateCard,
    deleteCard,
    moveCard,
  };
}
