/**
 * launchboard-data-utils.ts
 *
 * Pure LaunchBoard data helpers. This file owns deterministic sorting,
 * counting, id creation, and input normalization only.
 */

export const DEFAULT_COLUMNS = [
  { title: 'Backlog', accent: 'bg-blue-500' },
  { title: 'In Progress', accent: 'bg-amber-500' },
  { title: 'Done', accent: 'bg-emerald-500' },
] as const;

export function createId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

export function bySortOrder<T extends { sort_order: number }>(a: T, b: T): number {
  return a.sort_order - b.sort_order;
}

export function firstSorted<T extends { sort_order: number }>(rows: T[]): T | null {
  return rows.sort(bySortOrder)[0] ?? null;
}

export function countBy<T>(rows: T[], getKey: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = getKey(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function normalizeOptionalText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeRequiredText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function namesMatch(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

export function reindexRows<T extends { sort_order: number }>(
  rows: T[],
  update: (row: T, order: number) => void,
): void {
  rows.sort(bySortOrder).forEach((row, index) => {
    if (row.sort_order !== index) update(row, index);
  });
}
