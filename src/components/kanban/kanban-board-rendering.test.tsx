import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Button } from '../ui/button';
import { KanbanBoard, type KanbanBoardProps } from './kanban-board';

const columns = [{ id: 'open', title: 'Open' }];
const items = [{ id: 'task-1', columnId: 'open', title: 'First task' }];

describe('KanbanBoard rendering contracts', () => {
  test('keeps a read-only card out of the button tab order when it has no click action', () => {
    const markup = renderBoard({ dragEnabled: false });
    const activator = openingTag(markup, 'kanban-item-activator');

    expect(activator).not.toContain('role="button"');
    expect(activator).not.toContain('tabindex=');
    expect(activator).toContain('select-text');
  });

  test('keeps explicit card activation keyboard accessible without drag sensors', () => {
    const markup = renderBoard({
      dragEnabled: false,
      onItemClick: () => undefined,
    });
    const activator = openingTag(markup, 'kanban-item-activator');

    expect(activator).toContain('role="button"');
    expect(activator).toContain('tabindex="0"');
  });

  test('renders card actions beside the drag activator and suppresses them when disabled', () => {
    let actionRenders = 0;
    const active = renderBoard({
      renderItemActions: ({ item }) => {
        actionRenders += 1;
        return <Button type="button">Delete {item.title}</Button>;
      },
    });

    expect(actionRenders).toBe(1);
    expect(active).toContain(
      '</span></div><div data-slot="kanban-item-actions"',
    );

    actionRenders = 0;
    const disabled = renderBoard({
      disabled: true,
      renderItemActions: () => {
        actionRenders += 1;
        return <Button type="button">Delete</Button>;
      },
    });
    const board = openingTag(disabled, 'kanban-board');

    expect(actionRenders).toBe(0);
    expect(board).toContain('aria-disabled="true"');
    expect(board).toContain('inert=""');
    expect(disabled).not.toContain('kanban-item-actions');
  });
});

function renderBoard(
  props: Partial<KanbanBoardProps<(typeof columns)[number], (typeof items)[number]>>,
): string {
  return renderToStaticMarkup(
    <KanbanBoard
      columns={columns}
      items={items}
      getColumnId={(column) => column.id}
      getColumnTitle={(column) => column.title}
      getItemId={(item) => item.id}
      getItemColumnId={(item) => item.columnId}
      renderItem={({ item }) => <span>{item.title}</span>}
      {...props}
    />,
  );
}

function openingTag(markup: string, slot: string): string {
  const marker = `data-slot="${slot}"`;
  const markerIndex = markup.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf('<', markerIndex);
  const end = markup.indexOf('>', markerIndex);
  return markup.slice(start, end + 1);
}
