/**
 * types.ts
 *
 * App-local LaunchBoard data contracts. Persistence, resource policy, and UI
 * composition live in separate files so the demo mirrors normal Zero app
 * structure.
 */

export type CardPriority = 'low' | 'medium' | 'high';

export interface LaunchOwnedRow extends Record<string, unknown> {
  owner_id: string;
}

export interface LaunchCategory extends LaunchOwnedRow {
  category_id: string;
  name: string;
  description?: string;
  color: string;
  sort_order: number;
}

export interface LaunchBoard extends LaunchOwnedRow {
  board_id: string;
  category_id: string;
  name: string;
  description?: string;
  sort_order: number;
}

export interface LaunchColumn extends LaunchOwnedRow {
  column_id: string;
  board_id: string;
  title: string;
  accent: string;
  sort_order: number;
}

export interface LaunchCard extends LaunchOwnedRow {
  card_id: string;
  board_id: string;
  column_id: string;
  title: string;
  description?: string;
  priority: CardPriority;
  sort_order: number;
}

export interface CategoryInput {
  name: string;
  description?: string;
  color: string;
}

export interface BoardInput {
  name: string;
  description?: string;
}

export interface ColumnInput {
  title: string;
  accent: string;
}

export interface CardInput {
  column_id: string;
  title: string;
  description?: string;
  priority: CardPriority;
}
