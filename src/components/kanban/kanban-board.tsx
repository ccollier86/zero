'use client';

/**
 * kanban-board.tsx
 *
 * Renders Zero's tokenized Kanban board organism. The component owns drag/drop
 * interaction, keyboard movement, and board layout only; app code owns data
 * persistence through onItemMove.
 */

import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'motion/react';

import { Avatar, AvatarFallback, AvatarImage } from '#zero/components/ui/avatar';
import { Badge, badgeVariants } from '#zero/components/ui/badge';
import { ScrollArea } from '#zero/components/ui/scroll-area';
import { cn } from '#zero/lib/utils';
import type { ProjectKanbanMoveResult } from './kanban-utils';
import { groupKanbanItemIds, projectKanbanMove, type KanbanTarget } from './kanban-utils';

type BadgeVariant = NonNullable<Parameters<typeof badgeVariants>[0]>['variant'];

interface KanbanRenderContext<TColumn, TItem> {
  column: TColumn;
  columnId: string;
  item: TItem;
  itemId: string;
  isDragging: boolean;
  isOverlay: boolean;
}

export interface KanbanItemMove<TColumn, TItem> {
  item: TItem;
  itemId: string;
  fromColumn: TColumn;
  fromColumnId: string;
  toColumn: TColumn;
  toColumnId: string;
  fromIndex: number;
  toIndex: number;
  orderedItemIds: string[];
  orderedColumnItemIds: Record<string, string[]>;
}

export interface KanbanBoardProps<TColumn, TItem> {
  columns: TColumn[];
  items: TItem[];
  getColumnId: (column: TColumn) => string;
  getColumnTitle: (column: TColumn) => React.ReactNode;
  getItemId: (item: TItem) => string;
  getItemColumnId: (item: TItem) => string;
  onItemMove?: (move: KanbanItemMove<TColumn, TItem>) => void;
  onItemClick?: (item: TItem, context: KanbanRenderContext<TColumn, TItem>) => void;
  renderItem?: (context: KanbanRenderContext<TColumn, TItem>) => React.ReactNode;
  /** Render controls beside, rather than inside, the keyboard drag activator. */
  renderItemActions?: (context: KanbanRenderContext<TColumn, TItem>) => React.ReactNode;
  renderColumnHeader?: (context: { column: TColumn; columnId: string; itemCount: number }) => React.ReactNode;
  getColumnAccentClassName?: (column: TColumn) => string | undefined;
  getColumnClassName?: (column: TColumn) => string | undefined;
  getItemClassName?: (item: TItem) => string | undefined;
  getItemTitle?: (item: TItem) => React.ReactNode;
  getItemDescription?: (item: TItem) => React.ReactNode;
  getItemBadge?: (item: TItem) => React.ReactNode;
  getItemBadgeVariant?: (item: TItem) => BadgeVariant;
  getItemAssigneeName?: (item: TItem) => string | undefined;
  getItemAssigneeAvatar?: (item: TItem) => string | undefined;
  getItemAssigneeFallback?: (item: TItem) => string | undefined;
  emptyColumnText?: React.ReactNode;
  /** Disable drag sensors without dimming or blocking readable board content. */
  dragEnabled?: boolean;
  /** Disable every board interaction and apply unavailable-state styling. */
  disabled?: boolean;
  className?: string;
  boardClassName?: string;
  columnWidthClassName?: string;
}

export interface KanbanTaskCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  badgeVariant?: BadgeVariant;
  assigneeName?: string;
  assigneeAvatar?: string;
  assigneeFallback?: string;
  dragging?: boolean;
  dimmed?: boolean;
  className?: string;
}

interface ProjectionState {
  itemIds: string[];
  itemColumnIds: Record<string, string>;
}

interface DragBaseState {
  itemIds: string[];
  itemColumnIds: Record<string, string>;
}

const ITEM_PREFIX = 'item:';
const COLUMN_PREFIX = 'column:';

/**
 * Tokenized, generic Kanban board with pointer and keyboard drag/drop.
 *
 * The board is controlled: persist moves in `onItemMove` by updating your
 * source data, for example through `useCollection().update()`.
 */
export function KanbanBoard<TColumn, TItem>({
  columns,
  items,
  getColumnId,
  getColumnTitle,
  getItemId,
  getItemColumnId,
  onItemMove,
  onItemClick,
  renderItem,
  renderItemActions,
  renderColumnHeader,
  getColumnAccentClassName,
  getColumnClassName,
  getItemClassName,
  getItemTitle,
  getItemDescription,
  getItemBadge,
  getItemBadgeVariant,
  getItemAssigneeName,
  getItemAssigneeAvatar,
  getItemAssigneeFallback,
  emptyColumnText = 'Drop here',
  dragEnabled = true,
  disabled = false,
  className,
  boardClassName,
  columnWidthClassName = 'w-[min(20rem,82vw)]',
}: KanbanBoardProps<TColumn, TItem>) {
  const [activeItemId, setActiveItemId] = React.useState<string | null>(null);
  const [projection, setProjection] = React.useState<ProjectionState | null>(null);
  const movedRef = React.useRef(false);
  const dragBaseRef = React.useRef<DragBaseState | null>(null);
  const lastMoveRef = React.useRef<ProjectKanbanMoveResult | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnIds = React.useMemo(
    () => columns.map((column) => getColumnId(column)),
    [columns, getColumnId],
  );

  const columnMap = React.useMemo(() => {
    const map = new Map<string, TColumn>();
    for (const column of columns) map.set(getColumnId(column), column);
    return map;
  }, [columns, getColumnId]);

  const itemMap = React.useMemo(() => {
    const map = new Map<string, TItem>();
    for (const item of items) map.set(getItemId(item), item);
    return map;
  }, [items, getItemId]);

  const baseItemIds = React.useMemo(
    () => items.map((item) => getItemId(item)),
    [items, getItemId],
  );

  const baseItemColumnIds = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of items) map[getItemId(item)] = getItemColumnId(item);
    return map;
  }, [items, getItemId, getItemColumnId]);

  const effectiveItemIds = projection?.itemIds ?? baseItemIds;
  const effectiveItemColumnIds = projection?.itemColumnIds ?? baseItemColumnIds;

  const groupedItems = React.useMemo(() => {
    const groupedIds = groupKanbanItemIds(columnIds, effectiveItemIds, effectiveItemColumnIds);

    return columns.map((column) => {
      const columnId = getColumnId(column);
      return {
        column,
        columnId,
        items: (groupedIds[columnId] ?? [])
          .map((itemId) => itemMap.get(itemId))
          .filter((item): item is TItem => Boolean(item)),
      };
    });
  }, [columnIds, columns, effectiveItemColumnIds, effectiveItemIds, getColumnId, itemMap]);

  const activeItem = activeItemId ? itemMap.get(activeItemId) ?? null : null;
  const activeColumnId = activeItemId ? effectiveItemColumnIds[activeItemId] ?? null : null;
  const activeColumn = activeColumnId ? columnMap.get(activeColumnId) ?? null : null;

  const projectMove = React.useCallback(
    (activeId: string, target: KanbanTarget) =>
      projectKanbanMove({
        columnIds,
        itemIds: dragBaseRef.current?.itemIds ?? baseItemIds,
        itemColumnIds: dragBaseRef.current?.itemColumnIds ?? baseItemColumnIds,
        activeId,
        target,
      }),
    [baseItemColumnIds, baseItemIds, columnIds],
  );

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const itemId = decodeItemId(event.active.id);
    if (!itemId) return;
    movedRef.current = false;
    dragBaseRef.current = {
      itemIds: baseItemIds,
      itemColumnIds: baseItemColumnIds,
    };
    lastMoveRef.current = null;
    setActiveItemId(itemId);
  }, [baseItemColumnIds, baseItemIds]);

  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    const itemId = decodeItemId(event.active.id);
    const target = decodeTargetId(event.over?.id);
    if (!itemId || !target) return;

    const next = projectMove(itemId, target);
    if (!next) return;

    movedRef.current = true;
    lastMoveRef.current = next;
    setProjection({
      itemIds: next.itemIds,
      itemColumnIds: next.itemColumnIds,
    });
  }, [projectMove]);

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const itemId = decodeItemId(event.active.id);
    const target = decodeTargetId(event.over?.id);
    const projectedMove = itemId && target ? projectMove(itemId, target) : null;
    const next = projectedMove ?? lastMoveRef.current;
    const hadMove = movedRef.current;

    if (next && itemId) {
      emitMove(next, itemId);
    }

    if (hadMove) {
      window.setTimeout(() => {
        movedRef.current = false;
      }, 0);
    } else {
      movedRef.current = false;
    }
    dragBaseRef.current = null;
    lastMoveRef.current = null;
    setActiveItemId(null);
    setProjection(null);
  }, [projectMove]);

  const handleDragCancel = React.useCallback(() => {
    movedRef.current = false;
    dragBaseRef.current = null;
    lastMoveRef.current = null;
    setActiveItemId(null);
    setProjection(null);
  }, []);

  function emitMove(next: ProjectKanbanMoveResult, itemId: string) {
    const item = itemMap.get(itemId);
    const fromColumn = columnMap.get(next.fromColumnId);
    const toColumn = columnMap.get(next.toColumnId);
    if (!item || !fromColumn || !toColumn) return;

    onItemMove?.({
      item,
      itemId,
      fromColumn,
      fromColumnId: next.fromColumnId,
      toColumn,
      toColumnId: next.toColumnId,
      fromIndex: next.fromIndex,
      toIndex: next.toIndex,
      orderedItemIds: next.itemIds,
      orderedColumnItemIds: next.columnItemIds,
    });
  }

  return (
    <div className={cn('rounded-lg border border-border/80 bg-background p-3', className)}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          data-slot="kanban-board"
          aria-disabled={disabled || undefined}
          inert={disabled ? true : undefined}
          className={cn(
            'flex min-h-[28rem] gap-3 overflow-x-auto pb-2',
            disabled && 'pointer-events-none opacity-60',
            boardClassName,
          )}
        >
          {groupedItems.map(({ column, columnId, items: columnItems }) => (
            <KanbanColumn
              key={columnId}
              columnId={columnId}
              itemCount={columnItems.length}
              title={getColumnTitle(column)}
              accentClassName={getColumnAccentClassName?.(column)}
              className={cn(columnWidthClassName, getColumnClassName?.(column))}
              header={renderColumnHeader?.({ column, columnId, itemCount: columnItems.length })}
              emptyColumnText={emptyColumnText}
            >
              <SortableContext
                items={columnItems.map((item) => encodeItemId(getItemId(item)))}
                strategy={verticalListSortingStrategy}
              >
                <AnimatePresence initial={false}>
                  {columnItems.map((item) => {
                    const itemId = getItemId(item);
                    const itemContext = {
                      column,
                      columnId,
                      item,
                      itemId,
                      isDragging: activeItemId === itemId,
                      isOverlay: false,
                    } satisfies KanbanRenderContext<TColumn, TItem>;
                    return (
                      <SortableKanbanItem
                        key={itemId}
                        id={itemId}
                        disabled={disabled}
                        dragEnabled={dragEnabled}
                        active={activeItemId === itemId}
                        className={getItemClassName?.(item)}
                        actions={disabled ? null : renderItemActions?.(itemContext)}
                        onClick={onItemClick ? () => {
                          if (movedRef.current) {
                            movedRef.current = false;
                            return;
                          }
                          onItemClick(item, {
                            column,
                            columnId,
                            item,
                            itemId,
                            isDragging: false,
                            isOverlay: false,
                          });
                        } : undefined}
                      >
                        {(isDragging) => renderKanbanItem({
                          ...itemContext,
                          isDragging,
                        })}
                      </SortableKanbanItem>
                    );
                  })}
                </AnimatePresence>
              </SortableContext>
            </KanbanColumn>
          ))}
        </div>

        <DragOverlay adjustScale={false}>
          {activeItem && activeColumn ? (
            <div className={cn(columnWidthClassName, 'max-w-[20rem]')}>
              {renderKanbanItem({
                column: activeColumn,
                columnId: activeColumnId!,
                item: activeItem,
                itemId: activeItemId!,
                isDragging: true,
                isOverlay: true,
              })}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );

  function renderKanbanItem(context: KanbanRenderContext<TColumn, TItem>) {
    if (renderItem) return renderItem(context);

    return (
      <KanbanTaskCard
        title={getItemTitle?.(context.item) ?? context.itemId}
        description={getItemDescription?.(context.item)}
        badge={getItemBadge?.(context.item)}
        badgeVariant={getItemBadgeVariant?.(context.item)}
        assigneeName={getItemAssigneeName?.(context.item)}
        assigneeAvatar={getItemAssigneeAvatar?.(context.item)}
        assigneeFallback={getItemAssigneeFallback?.(context.item)}
        dragging={context.isDragging || context.isOverlay}
        dimmed={context.isDragging && !context.isOverlay}
        className={getItemClassName?.(context.item)}
      />
    );
  }
}

export function KanbanTaskCard({
  title,
  description,
  badge,
  badgeVariant = 'secondary',
  assigneeName,
  assigneeAvatar,
  assigneeFallback,
  dragging,
  dimmed,
  className,
}: KanbanTaskCardProps) {
  return (
    <div
      data-slot="kanban-task-card"
      className={cn(
        'rounded-lg border border-border/80 bg-card p-3 text-card-foreground shadow-xs outline-none transition-[border-color,box-shadow,opacity,transform] dark:shadow-none',
        'hover:border-border-strong hover:bg-card/95',
        dragging && 'border-ring/55 shadow-lg ring-2 ring-ring/25 dark:shadow-none',
        dimmed && 'opacity-40',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug text-foreground">{title}</div>
          {description ? (
            <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
      </div>

      {(badge || assigneeName || assigneeFallback || assigneeAvatar) && (
        <div className="mt-3 flex items-center justify-between gap-2">
          {badge ? <Badge variant={badgeVariant}>{badge}</Badge> : <span />}
          {(assigneeName || assigneeFallback || assigneeAvatar) && (
            <div className="flex min-w-0 items-center gap-2">
              {assigneeName ? (
                <span className="truncate text-xs text-muted-foreground">{assigneeName}</span>
              ) : null}
              <Avatar className="size-7 border border-border bg-muted">
                {assigneeAvatar ? <AvatarImage src={assigneeAvatar} alt={assigneeName ?? assigneeFallback ?? 'Assignee'} /> : null}
                <AvatarFallback>{assigneeFallback ?? assigneeName?.slice(0, 2).toUpperCase() ?? 'U'}</AvatarFallback>
              </Avatar>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface KanbanColumnProps {
  columnId: string;
  title: React.ReactNode;
  itemCount: number;
  accentClassName?: string;
  className?: string;
  header?: React.ReactNode;
  emptyColumnText: React.ReactNode;
  children: React.ReactNode;
}

function KanbanColumn({
  columnId,
  title,
  itemCount,
  accentClassName,
  className,
  header,
  emptyColumnText,
  children,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: encodeColumnId(columnId) });

  return (
    <section
      ref={setNodeRef}
      data-slot="kanban-column"
      data-over={isOver ? '' : undefined}
      className={cn(
        'flex shrink-0 flex-col rounded-lg border border-border/75 bg-muted/35 transition-colors data-[over]:border-ring/55 data-[over]:bg-accent/45',
        className,
      )}
    >
      {header ?? (
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5">
          <span
            className={cn('size-2.5 shrink-0 rounded-full bg-muted-foreground/35', accentClassName)}
            aria-hidden="true"
          />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {title}
          </h3>
          <span className="rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
            {itemCount}
          </span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-[24rem] flex-col gap-2 p-2.5">
          {children}
          {itemCount === 0 && (
            <div className="grid min-h-24 place-items-center rounded-lg border border-dashed border-border/80 bg-background/60 px-3 text-center text-xs text-muted-foreground">
              {emptyColumnText}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

interface SortableKanbanItemProps {
  id: string;
  disabled: boolean;
  dragEnabled: boolean;
  active: boolean;
  className?: string;
  actions?: React.ReactNode;
  onClick?: () => void;
  children: (isDragging: boolean) => React.ReactNode;
}

function SortableKanbanItem({
  id,
  disabled,
  dragEnabled,
  active,
  className,
  actions,
  onClick,
  children,
}: SortableKanbanItemProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: encodeItemId(id), disabled: disabled || !dragEnabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <motion.div
      ref={setNodeRef}
      data-slot="kanban-sortable-item"
      className={cn(
        'relative opacity-100 transition-opacity',
        active && 'opacity-0',
        className,
      )}
      style={style}
      layout
      initial={{ y: 6 }}
      animate={{ y: 0 }}
      exit={{ y: -6 }}
      transition={{ duration: 0.16 }}
    >
      <div
        ref={setActivatorNodeRef}
        data-slot="kanban-item-activator"
        className={cn(
          'outline-none',
          dragEnabled && !disabled
            ? 'cursor-grab touch-manipulation active:cursor-grabbing'
            : 'cursor-default select-text',
        )}
        {...(dragEnabled && !disabled ? attributes : {})}
        tabIndex={disabled
          ? -1
          : dragEnabled
            ? attributes.tabIndex ?? 0
            : onClick
              ? 0
              : undefined}
        role={!dragEnabled && onClick ? 'button' : undefined}
        onClick={disabled ? undefined : onClick}
        onKeyDown={!dragEnabled && onClick && !disabled
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined}
        {...(dragEnabled && !disabled ? listeners : {})}
      >
        {children(active)}
      </div>
      {actions && !active ? (
        <div data-slot="kanban-item-actions" className="absolute right-2 top-2 z-10">
          {actions}
        </div>
      ) : null}
    </motion.div>
  );
}

function encodeItemId(id: string): string {
  return `${ITEM_PREFIX}${id}`;
}

function encodeColumnId(id: string): string {
  return `${COLUMN_PREFIX}${id}`;
}

function decodeItemId(id: UniqueIdentifier | undefined | null): string | null {
  const value = String(id ?? '');
  return value.startsWith(ITEM_PREFIX) ? value.slice(ITEM_PREFIX.length) : null;
}

function decodeTargetId(id: UniqueIdentifier | undefined | null): KanbanTarget | null {
  const value = String(id ?? '');
  if (value.startsWith(ITEM_PREFIX)) return { type: 'item', id: value.slice(ITEM_PREFIX.length) };
  if (value.startsWith(COLUMN_PREFIX)) return { type: 'column', id: value.slice(COLUMN_PREFIX.length) };
  return null;
}
