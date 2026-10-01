export type PlatformWorkspaceErrorSource = 'directory' | 'members' | 'mutation' | 'local';

export interface PlatformWorkspaceVisibleError {
  message: string;
  source: PlatformWorkspaceErrorSource;
}

/** Keep directory and mutation failures in the directory surface only. */
export function resolvePlatformWorkspaceDirectoryError(errors: {
  directoryError: string | null;
  mutationError: string | null;
}): PlatformWorkspaceVisibleError | null {
  if (errors.mutationError) return { message: errors.mutationError, source: 'mutation' };
  if (errors.directoryError) return { message: errors.directoryError, source: 'directory' };
  return null;
}

/** Keep selected-member reads and member actions in the focused people surface. */
export function resolvePlatformWorkspaceMemberError(errors: {
  localError: string | null;
  mutationError: string | null;
  membersError: string | null;
}): PlatformWorkspaceVisibleError | null {
  if (errors.localError) return { message: errors.localError, source: 'local' };
  if (errors.mutationError) return { message: errors.mutationError, source: 'mutation' };
  if (errors.membersError) return { message: errors.membersError, source: 'members' };
  return null;
}

export function retryPlatformWorkspaceDirectoryError(
  error: PlatformWorkspaceVisibleError | null,
  actions: {
    clearMutationError(): void;
    reloadDirectory(): void;
  },
): void {
  if (error?.source === 'mutation') actions.clearMutationError();
  actions.reloadDirectory();
}

export function retryPlatformWorkspaceMemberError(
  error: PlatformWorkspaceVisibleError | null,
  actions: {
    clearLocalError(): void;
    clearMutationError(): void;
    reloadMembers(): void;
  },
): void {
  actions.clearLocalError();
  if (error?.source === 'mutation' || error?.source === 'local') {
    actions.clearMutationError();
  }
  actions.reloadMembers();
}
