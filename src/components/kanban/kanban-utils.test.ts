import { describe, expect, test } from 'bun:test';

import { groupKanbanItemIds, projectKanbanMove } from './kanban-utils';

describe('kanban movement helpers', () => {
  const columnIds = ['todo', 'doing', 'done'];
  const itemIds = ['a', 'b', 'c', 'd'];
  const itemColumnIds = {
    a: 'todo',
    b: 'todo',
    c: 'doing',
    d: 'done',
  };

  test('groups item ids by column while preserving order', () => {
    expect(groupKanbanItemIds(columnIds, itemIds, itemColumnIds)).toEqual({
      todo: ['a', 'b'],
      doing: ['c'],
      done: ['d'],
    });
  });

  test('projects a same-column reorder', () => {
    const move = projectKanbanMove({
      columnIds,
      itemIds,
      itemColumnIds,
      activeId: 'a',
      target: { type: 'item', id: 'b' },
    });

    expect(move).toMatchObject({
      itemIds: ['b', 'a', 'c', 'd'],
      columnItemIds: {
        todo: ['b', 'a'],
      },
      fromColumnId: 'todo',
      toColumnId: 'todo',
      fromIndex: 0,
      toIndex: 1,
    });
  });

  test('projects a cross-column move onto an item', () => {
    const move = projectKanbanMove({
      columnIds,
      itemIds,
      itemColumnIds,
      activeId: 'b',
      target: { type: 'item', id: 'c' },
    });

    expect(move).toMatchObject({
      itemIds: ['a', 'b', 'c', 'd'],
      itemColumnIds: {
        b: 'doing',
      },
      columnItemIds: {
        todo: ['a'],
        doing: ['b', 'c'],
      },
      fromColumnId: 'todo',
      toColumnId: 'doing',
      fromIndex: 1,
      toIndex: 0,
    });
  });

  test('projects a cross-column move into an empty target column area', () => {
    const move = projectKanbanMove({
      columnIds,
      itemIds: ['a', 'b'],
      itemColumnIds: { a: 'todo', b: 'todo' },
      activeId: 'a',
      target: { type: 'column', id: 'done' },
    });

    expect(move).toMatchObject({
      itemIds: ['b', 'a'],
      itemColumnIds: {
        a: 'done',
      },
      fromColumnId: 'todo',
      toColumnId: 'done',
      fromIndex: 0,
      toIndex: 0,
    });
  });
});
