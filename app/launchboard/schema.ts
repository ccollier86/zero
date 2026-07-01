/**
 * schema.ts
 *
 * LaunchBoard app-owned schema. The same `tables` object is passed to
 * createApp() and AppProvider so server and browser share one contract.
 */

import { defineTable, field } from '@zero/framework/schema';

export const launchCategories = defineTable(
  'launch_categories',
  {
    name: field.text({ label: 'Name', required: true, tableVisible: true }),
    description: field.text({ label: 'Description', tableVisible: true }),
    color: field.text({ label: 'Color', required: true, tableVisible: false }),
    sort_order: field.number({ label: 'Order', integer: true, tableVisible: false }),
  },
  { pk: 'category_id', sync: 'full' },
);

export const launchBoards = defineTable(
  'launch_boards',
  {
    category_id: field.text({ label: 'Category', required: true, tableVisible: true }),
    name: field.text({ label: 'Name', required: true, tableVisible: true }),
    description: field.text({ label: 'Description', tableVisible: true }),
    sort_order: field.number({ label: 'Order', integer: true, tableVisible: false }),
  },
  { pk: 'board_id', sync: 'full' },
);

export const launchColumns = defineTable(
  'launch_columns',
  {
    board_id: field.text({ label: 'Board', required: true, tableVisible: true }),
    title: field.text({ label: 'Title', required: true, tableVisible: true }),
    accent: field.text({ label: 'Accent', required: true, tableVisible: false }),
    sort_order: field.number({ label: 'Order', integer: true, tableVisible: false }),
  },
  { pk: 'column_id', sync: 'full' },
);

export const launchCards = defineTable(
  'launch_cards',
  {
    board_id: field.text({ label: 'Board', required: true, tableVisible: true }),
    column_id: field.text({ label: 'Column', required: true, tableVisible: true }),
    title: field.text({ label: 'Title', required: true, tableVisible: true }),
    description: field.text({ label: 'Description', tableVisible: true }),
    priority: field.select(
      [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
      ],
      {
        label: 'Priority',
        required: true,
        tableVisible: true,
      },
    ),
    sort_order: field.number({ label: 'Order', integer: true, tableVisible: false }),
  },
  { pk: 'card_id', sync: 'full' },
);

export const tables = {
  launch_categories: launchCategories,
  launch_boards: launchBoards,
  launch_columns: launchColumns,
  launch_cards: launchCards,
};
