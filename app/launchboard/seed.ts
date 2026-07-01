/**
 * seed.ts
 *
 * Deterministic LaunchBoard seed data for the app playground. This file owns
 * the demo defaults only; runtime mutations live in the ReactiveDB data hook.
 */

import type { LaunchBoardSeedData } from './types';

export const COLUMN_ACCENTS = [
  { label: 'Blue', value: 'bg-blue-500' },
  { label: 'Amber', value: 'bg-amber-500' },
  { label: 'Emerald', value: 'bg-emerald-500' },
  { label: 'Rose', value: 'bg-rose-500' },
  { label: 'Violet', value: 'bg-violet-500' },
  { label: 'Slate', value: 'bg-slate-500' },
];

export function createInitialLaunchBoardSeed(): LaunchBoardSeedData {
  return {
    categories: [
      {
        category_id: 'category-client-work',
        name: 'Client Work',
        description: 'Production projects and delivery boards.',
        color: 'bg-blue-500',
        sort_order: 0,
      },
      {
        category_id: 'category-platform',
        name: 'Platform',
        description: 'Zero framework polish and reusable systems.',
        color: 'bg-emerald-500',
        sort_order: 1,
      },
    ],
    boards: [
      {
        board_id: 'board-client-launch',
        category_id: 'category-client-work',
        name: 'Launch Plan',
        description: 'Track client app work from intake through delivery.',
        sort_order: 0,
      },
      {
        board_id: 'board-clinic-intake',
        category_id: 'category-client-work',
        name: 'Clinic Intake',
        description: 'Public intake flow and staff review tasks.',
        sort_order: 1,
      },
      {
        board_id: 'board-zero-ui',
        category_id: 'category-platform',
        name: 'Zero UI',
        description: 'Reusable components, hooks, and shell work.',
        sort_order: 0,
      },
    ],
    columns: [
      { column_id: 'column-launch-backlog', board_id: 'board-client-launch', title: 'Backlog', accent: 'bg-blue-500', sort_order: 0 },
      { column_id: 'column-launch-active', board_id: 'board-client-launch', title: 'In Progress', accent: 'bg-amber-500', sort_order: 1 },
      { column_id: 'column-launch-done', board_id: 'board-client-launch', title: 'Done', accent: 'bg-emerald-500', sort_order: 2 },
      { column_id: 'column-intake-backlog', board_id: 'board-clinic-intake', title: 'Queued', accent: 'bg-violet-500', sort_order: 0 },
      { column_id: 'column-intake-active', board_id: 'board-clinic-intake', title: 'Working', accent: 'bg-amber-500', sort_order: 1 },
      { column_id: 'column-intake-done', board_id: 'board-clinic-intake', title: 'Ready', accent: 'bg-emerald-500', sort_order: 2 },
      { column_id: 'column-ui-backlog', board_id: 'board-zero-ui', title: 'Backlog', accent: 'bg-blue-500', sort_order: 0 },
      { column_id: 'column-ui-active', board_id: 'board-zero-ui', title: 'Building', accent: 'bg-amber-500', sort_order: 1 },
      { column_id: 'column-ui-done', board_id: 'board-zero-ui', title: 'Shipped', accent: 'bg-emerald-500', sort_order: 2 },
    ],
    cards: [
      {
        card_id: 'card-launch-data',
        board_id: 'board-client-launch',
        column_id: 'column-launch-backlog',
        title: 'Define production data models',
        description: 'Lock the tables, natural identities, and resource policies before building screens.',
        priority: 'high',
        sort_order: 0,
      },
      {
        card_id: 'card-launch-shell',
        board_id: 'board-client-launch',
        column_id: 'column-launch-active',
        title: 'Compose dashboard shell',
        description: 'Use AppShell with category switcher, board navigation, and breadcrumb context.',
        priority: 'medium',
        sort_order: 0,
      },
      {
        card_id: 'card-launch-docs',
        board_id: 'board-client-launch',
        column_id: 'column-launch-done',
        title: 'Document app conventions',
        description: 'Write the start-here notes that tell agents which Zero APIs to use first.',
        priority: 'low',
        sort_order: 0,
      },
      {
        card_id: 'card-intake-token',
        board_id: 'board-clinic-intake',
        column_id: 'column-intake-backlog',
        title: 'Resume token flow',
        description: 'Let a public patient continue a long intake form without creating an account.',
        priority: 'high',
        sort_order: 0,
      },
      {
        card_id: 'card-ui-shell',
        board_id: 'board-zero-ui',
        column_id: 'column-ui-active',
        title: 'Prove AppShell in LaunchBoard',
        description: 'Move the board playground onto the packaged shell and sidebar contract.',
        priority: 'high',
        sort_order: 0,
      },
    ],
  };
}

export interface LaunchBoardSeedDatabase {
  list(table: string): Record<string, unknown>[];
  insert(table: string, row: Record<string, unknown>): unknown;
}

/** Seed the LaunchBoard tables once, through ReactiveDB. */
export function seedLaunchBoardDatabase(db: LaunchBoardSeedDatabase): void {
  if (db.list('launch_categories').length > 0) return;

  const seed = createInitialLaunchBoardSeed();
  for (const category of seed.categories) db.insert('launch_categories', category);
  for (const board of seed.boards) db.insert('launch_boards', board);
  for (const column of seed.columns) db.insert('launch_columns', column);
  for (const card of seed.cards) db.insert('launch_cards', card);
}
