/**
 * kanban-utils.ts
 *
 * Pure movement helpers for the KanbanBoard component. This file owns list
 * projection only; React rendering and drag sensors live in kanban-board.tsx.
 */

export type KanbanTarget =
  | { type: 'column'; id: string }
  | { type: 'item'; id: string };

export interface ProjectKanbanMoveInput {
  columnIds: string[];
  itemIds: string[];
  itemColumnIds: Record<string, string>;
  activeId: string;
  target: KanbanTarget;
}

export interface ProjectKanbanMoveResult {
  itemIds: string[];
  itemColumnIds: Record<string, string>;
  columnItemIds: Record<string, string[]>;
  fromColumnId: string;
  toColumnId: string;
  fromIndex: number;
  toIndex: number;
}

/**
 * Group item ids by column while preserving the caller-provided item order.
 */
export function groupKanbanItemIds(
  columnIds: readonly string[],
  itemIds: readonly string[],
  itemColumnIds: Record<string, string>,
): Record<string, string[]> {
  const groups = Object.fromEntries(columnIds.map((id) => [id, [] as string[]]));

  for (const itemId of itemIds) {
    const columnId = itemColumnIds[itemId];
    if (columnId && groups[columnId]) groups[columnId].push(itemId);
  }

  return groups;
}

/**
 * Project a drag target into the next ordered item ids and column assignments.
 */
export function projectKanbanMove({
  columnIds,
  itemIds,
  itemColumnIds,
  activeId,
  target,
}: ProjectKanbanMoveInput): ProjectKanbanMoveResult | null {
  const fromColumnId = itemColumnIds[activeId];
  const toColumnId = target.type === 'column' ? target.id : itemColumnIds[target.id];

  if (!fromColumnId || !toColumnId) return null;
  if (!columnIds.includes(fromColumnId) || !columnIds.includes(toColumnId)) return null;
  if (target.type === 'item' && target.id === activeId) return null;

  const groups = groupKanbanItemIds(columnIds, itemIds, itemColumnIds);
  const fromIndex = groups[fromColumnId]?.indexOf(activeId) ?? -1;
  if (fromIndex < 0) return null;

  const nextGroups = Object.fromEntries(
    columnIds.map((columnId) => [
      columnId,
      (groups[columnId] ?? []).filter((itemId) => itemId !== activeId),
    ]),
  ) as Record<string, string[]>;

  let toIndex = nextGroups[toColumnId]?.length ?? 0;
  if (target.type === 'item') {
    const targetIndex = groups[toColumnId]?.indexOf(target.id) ?? -1;
    if (targetIndex >= 0) {
      toIndex = fromColumnId === toColumnId
        ? targetIndex
        : Math.max(0, nextGroups[toColumnId]!.indexOf(target.id));
    }
  }

  const targetGroup = nextGroups[toColumnId];
  if (!targetGroup) return null;
  const boundedIndex = Math.max(0, Math.min(toIndex, targetGroup.length));
  if (fromColumnId === toColumnId && fromIndex === boundedIndex) return null;

  targetGroup.splice(boundedIndex, 0, activeId);

  return {
    itemIds: columnIds.flatMap((columnId) => nextGroups[columnId] ?? []),
    itemColumnIds: {
      ...itemColumnIds,
      [activeId]: toColumnId,
    },
    columnItemIds: Object.fromEntries(
      columnIds.map((columnId) => [columnId, [...(nextGroups[columnId] ?? [])]]),
    ),
    fromColumnId,
    toColumnId,
    fromIndex,
    toIndex: boundedIndex,
  };
}
