export interface PlatformTenantDirectoryErrors {
  directoryError: string | null;
  selectedTenantMembersError: string | null;
  mutationError: string | null;
}

export type PlatformTenantDirectoryErrorAction =
  | { type: 'clear-all' }
  | { type: 'clear-directory' }
  | { type: 'fail-directory'; error: string }
  | { type: 'clear-selected-members' }
  | { type: 'fail-selected-members'; error: string }
  | { type: 'clear-mutation' }
  | { type: 'fail-mutation'; error: string };

export const EMPTY_PLATFORM_TENANT_DIRECTORY_ERRORS: PlatformTenantDirectoryErrors = {
  directoryError: null,
  selectedTenantMembersError: null,
  mutationError: null,
};

/** Update one platform-directory failure slice without disturbing its siblings. */
export function reducePlatformTenantDirectoryErrors(
  state: PlatformTenantDirectoryErrors,
  action: PlatformTenantDirectoryErrorAction,
): PlatformTenantDirectoryErrors {
  switch (action.type) {
    case 'clear-all':
      return EMPTY_PLATFORM_TENANT_DIRECTORY_ERRORS;
    case 'clear-directory':
      return state.directoryError === null ? state : { ...state, directoryError: null };
    case 'fail-directory':
      return { ...state, directoryError: action.error };
    case 'clear-selected-members':
      return state.selectedTenantMembersError === null
        ? state
        : { ...state, selectedTenantMembersError: null };
    case 'fail-selected-members':
      return { ...state, selectedTenantMembersError: action.error };
    case 'clear-mutation':
      return state.mutationError === null ? state : { ...state, mutationError: null };
    case 'fail-mutation':
      return { ...state, mutationError: action.error };
  }
}

/** Preserve the original aggregate-error precedence for compatibility consumers. */
export function platformTenantDirectoryAggregateError(
  state: PlatformTenantDirectoryErrors,
): string | null {
  return state.directoryError ?? state.selectedTenantMembersError ?? state.mutationError;
}
