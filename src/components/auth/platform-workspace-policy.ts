/** Pure presentation policy for the platform workspace directory. */

export interface PlatformWorkspaceTerminology {
  singular: string;
  plural: string;
}

export function resolvePlatformWorkspaceTerminology(
  terminology: { singular: string; plural: string } | undefined,
): PlatformWorkspaceTerminology {
  return {
    singular: terminology?.singular.trim() || 'organization',
    plural: terminology?.plural.trim() || 'organizations',
  };
}

export function boundedPlatformWorkspacePageSize(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(1, Math.trunc(value))) : 25;
}

/** Keep a valid selection while creation is pending; otherwise choose the first visible row. */
export function resolvePlatformWorkspaceSelectedId(
  selectedId: string | null | undefined,
  workspaceIds: readonly string[],
  pendingCreatedId?: string | null,
): string | null {
  if (pendingCreatedId) {
    return selectedId && workspaceIds.includes(selectedId) ? selectedId : null;
  }
  if (selectedId && workspaceIds.includes(selectedId)) return selectedId;
  return workspaceIds[0] ?? null;
}
