/**
 * hooks.ts
 *
 * Compatibility barrel for app-facing React hooks. Hook implementations live
 * in responsibility-focused files; this module preserves the historical
 * `src/frontend/client/hooks` import path for apps and platform components.
 */

export {
  ClientProvider,
  shouldUseSsrFallback,
  useClient,
  useClientMaybe,
  useIsServer,
} from './client-context';
export type { ClientProviderProps } from './client-context';

export {
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
} from './authorization-scope-hooks';
export type { AuthorizationScopeBoundary } from './authorization-scope-hooks';

export {
  useAuth,
  useAuthConfig,
  useCurrentUser,
  useRequireAuth,
  useUserProperty,
} from './auth-hooks';
export {
  useTenantMembers,
  useTenantOnboardingAdministration,
  useTenantSwitcher,
} from './tenant-administration-hooks';
export type {
  UseTenantMembersOptions,
  UseTenantMembersResult,
  UseTenantOnboardingAdministrationOptions,
  UseTenantOnboardingAdministrationResult,
  UseTenantSwitcherResult,
} from './tenant-administration-hooks';
export {
  usePlatformAdministration,
  usePlatformTenants,
} from './platform-administration-hooks';
export type {
  UsePlatformAdministrationOptions,
  UsePlatformAdministrationResult,
  UsePlatformTenantsOptions,
  UsePlatformTenantsResult,
} from './platform-administration-hooks';
export {
  useTenantAppShellWorkspaces,
} from './tenant-switch-presentation';
export type {
  UseTenantAppShellWorkspacesOptions,
} from './tenant-switch-presentation';
export {
  useDomainOnboarding,
  useTenantDomainAdministration,
} from './domain-onboarding-hooks';
export type {
  UseDomainOnboardingOptions,
  UseDomainOnboardingResult,
  UseTenantDomainAdministrationOptions,
  UseTenantDomainAdministrationResult,
} from './domain-onboarding-hooks';
export type {
  AuthActions,
  AuthConfigState,
  AuthState,
  AuthActionTokenInfo,
  AuthEmailVerificationRequiredResult,
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminMfaRequirement,
  AuthAdminMfaResetResult,
  AuthAdminUpdateUserParams,
  AuthAdminUserMfaStatus,
  AuthAdminUserPropertyConfig,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
  AuthPublicConfig,
  AuthUserPropertyConfig,
  AuthUser,
  RegisterParams,
  UseUserPropertyOptions,
  UseUserPropertyResult,
} from './auth-hooks';

export {
  useAuthorization,
  useHasAllPermissions,
  useHasAnyPermission,
  useHasPermission,
} from './authorization-hooks';
export type { UseAuthorizationResult } from './authorization-hooks';

export { useApplicationAccess } from './application-administration-hooks';
export type {
  UseApplicationAccessOptions,
  UseApplicationAccessResult,
} from './application-administration-hooks';

export { useAuthAudit } from './auth-audit-hooks';
export type {
  UseAuthAuditOptions,
  UseAuthAuditResult,
} from './auth-audit-hooks';

export {
  useCollection,
  useLazyCollection,
  useQuery,
  useRow,
  useStatus,
} from './data-hooks';
export type {
  CollectionResult,
  LazyCollectionOptions,
  LazyCollectionResult,
} from './data-hooks';

export {
  buildDataPageQuery,
  useDataPage,
  useRecord,
  useRecordByIdentity,
} from './data-composition-hooks';
export type {
  DataFilterExpression,
  DataFilterOperator,
  DataFilterPrimitive,
  DataFilterValue,
  DataPageFilters,
  DataPageInfo,
  DataPageOptions,
  DataPageResult,
  DataPageSort,
  IdentityRecordResult,
  RecordResult,
} from './data-composition-hooks';

export {
  useResourceActions,
  useResourceClient,
  useResourceList,
  useResourceRecord,
} from './resource-hooks';
export type {
  ResourceActionsResult,
  ResourceListHookResult,
  ResourceRecordResult,
  UseResourceListOptions,
  UseResourceRecordOptions,
} from './resource-hooks';

export {
  buildResourceListQuery,
} from './query-params';

export { useDataSelection } from './data-selection-hooks';
export type {
  DataSelectionMode,
  UseDataSelectionOptions,
  UseDataSelectionReturn,
} from './data-selection-hooks';

export { useConnectionHealth } from './connection-health-hooks';
export type { ConnectionHealth } from './connection-health-hooks';

export { useMutation } from './mutation-hooks';
export type { UseMutationOptions, UseMutationReturn } from './mutation-hooks';

export { useFormDraft, usePreference } from './preference-hooks';
export type {
  UseFormDraftOptions,
  UseFormDraftResult,
  UsePreferenceResult,
} from './preference-hooks';

export { useServerState, useServerStateReady } from '../../sync/client/state-hooks';
export { useParams, usePathname, useRouter } from './router-context';

export {
  useNotifications,
  useOnNewNotification,
  useUnreadCount,
} from './notification-hooks';
export type {
  Notification,
  NotificationReceipt,
  NotificationWithStatus,
  UseNotificationsResult,
} from './notification-hooks';

export {
  usePresence,
  useRoom,
  useRoomActions,
  useRoomData,
  useRoomMembers,
  useRooms,
} from './room-hooks';
export type {
  PresenceMember,
  RoomActions,
  UsePresenceResult,
  UseRoomResult,
} from './room-hooks';

export { usePresenceList } from './presence-list-hooks';
export type {
  PresenceListMember,
  UsePresenceListOptions,
  UsePresenceListReturn,
} from './presence-list-hooks';

export { useTypingIndicator } from './typing-indicator-hooks';
export type {
  TypingIndicatorMember,
  UseTypingIndicatorOptions,
  UseTypingIndicatorReturn,
} from './typing-indicator-hooks';

export { useWorkflowRun } from './workflow-run-hooks';
export type {
  UseWorkflowRunOptions,
  UseWorkflowRunResult,
  WorkflowProgress,
} from './workflow-run-hooks';

export {
  useEphemeral,
  useEphemeralErrors,
  useEphemeralTopic,
} from '../../sync/client/ephemeral-hooks';
