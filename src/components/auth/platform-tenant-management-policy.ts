interface PlatformTenantConfirmationCapabilities {
  canReadTenants: boolean;
  canManageTenants: boolean;
}

/** Fail closed when a lifecycle dialog outlives the actor's exact capabilities. */
export function canRetainPlatformTenantConfirmation(
  confirmationOpen: boolean,
  capabilities: PlatformTenantConfirmationCapabilities | null | undefined,
): boolean {
  return confirmationOpen
    && capabilities?.canReadTenants === true
    && capabilities.canManageTenants;
}

/** Route an error to one live alert, preferring the open modal. */
export function platformTenantErrorPlacement(
  error: string | null,
  confirmationOpen: boolean,
): Readonly<{ page: string | null; dialog: string | null }> {
  return confirmationOpen
    ? { page: null, dialog: error }
    : { page: error, dialog: null };
}
