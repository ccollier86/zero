/**
 * Platform Frontend — CLIENT-SAFE barrel exports.
 *
 * This is the default import for app code (pages, layouts, components).
 * Everything here is safe for browser bundles — no bun:sqlite, no server-only code.
 *
 * For server-only exports (createApp, plugins, etc.), import from:
 *   import { createApp } from '../src/frontend/server';
 *
 * @example
 * // In app pages/components:
 * import { AppProvider, useAuth, Button, DataTable } from '../src/frontend';
 *
 * // In app server entry (app.ts):
 * import { createApp } from '../src/frontend/server';
 */

// ─── Schema (pure JS — no server deps, no bun:sqlite) ──────────────────
export { defineTable, defineSchema, schema, field } from '../schema';
export type {
  SchemaDescriptor,
  TableDefinition,
  SchemaConfig,
  Schema,
  FieldType,
  FieldMeta,
  FieldDef,
  InferRow,
  InferInsert,
  InsertInput,
  PrimaryKeyOf,
  Register,
  TableNames,
  TableRow as RegisteredTableRow,
} from '../schema';
export { defineResourceFields } from '../resources/resource-field-access';
export type {
  ResourceFieldAccess,
  ResourceFieldAccessInput,
} from '../resources/resource-field-access';

// ─── SDK Core (vanilla JS — no React required) ──────────────────────────
export {
  createClient,
  getClient,
  FetchError,
  ResourceMutationError,
  SYNC_MUTATION_ERROR_CODES,
  SYNC_MUTATION_RECEIPT_DEFAULT_TIMEOUT_MS,
  SYNC_MUTATION_RECEIPT_MAX_TIMEOUT_MS,
  SyncMutationError,
  isSyncMutationError,
} from './client/sdk';
export type {
  Client,
  Collection,
  ClientConfig,
  FetchInit,
  InternalClient,
  ResourceClient,
  ResourceClientOptions,
  ResourceDeleteResult,
  ResourceListResult,
  ResourceMutationOptions,
  ResourceRowResult,
  SyncClient,
  SyncMutationErrorCode,
  SyncMutationErrorDetails,
  SyncMutationRejection,
  SyncMutationWaitOptions,
} from './client/sdk';
export {
  DATA_STUDIO_API_PREFIX,
  DataStudioMutationError,
  createDataStudioOperationId,
  createDataStudioSdkSurface,
  dataStudioCellValue,
  dataStudioRowQueryKey,
  dataStudioRowValuesByKey,
  isDataStudioMutationError,
  isDataStudioRevisionConflict,
} from './client/data-studio-client';
export type {
  DataStudioCacheSnapshot,
  DataStudioCapabilities,
  DataStudioColumn,
  DataStudioMutationFailureBody,
  DataStudioMutationOptions,
  DataStudioRequestOptions,
  DataStudioReconciliationEvent,
  DataStudioRow,
  DataStudioRowFilter,
  DataStudioRowFilterOperator,
  DataStudioRowFilterValue,
  DataStudioRowPage,
  DataStudioRowQuery,
  DataStudioRowValues,
  DataStudioSchema,
  DataStudioSchemaVersion,
  DataStudioSchemaVersionQuery,
  DataStudioSdkSurface,
  DataStudioSdkSurfaceOptions,
  DataStudioTable,
  DataStudioTableSummary,
  DataStudioTableCreate,
  DataStudioTableStatus,
  DataStudioTableUpdate,
  DataStudioValue,
} from './client/data-studio-client';
export {
  STORAGE_STUDIO_API_PREFIX,
  StorageStudioMutationError,
  createStorageStudioOperationId,
  createStorageStudioSdkSurface,
  isStorageStudioMutationError,
} from './client/storage-studio-client';
export type {
  StorageStudioMutationFailureBody,
  StorageStudioMutationOptions,
  StorageStudioRequestOptions,
  StorageStudioSdkSurface,
} from './client/storage-studio-client';
export {
  DATA_REALM_READINESS_DEFAULT_POLL_MS,
  DATA_REALM_READINESS_MAX_POLL_MS,
  DATA_REALM_READINESS_MIN_POLL_MS,
  DATA_REALM_READINESS_STATUSES,
  DataRealmReadinessContractError,
  dataRealmReadinessAllowsApplicationData,
  parseDataRealmReadinessSnapshot,
} from '../auth/data-realm-readiness-types';
export type {
  DataRealmReadinessScope,
  DataRealmReadinessSdkSurface,
  DataRealmReadinessSnapshot,
  DataRealmReadinessStatus,
} from '../auth/data-realm-readiness-types';
export type { IdentityKey, IdentityValue } from '../sync/identity';

// ─── Typed API (Eden Treaty) ────────────────────────────────────────────
export { ApiError, unwrap } from './client/api';
export type { Api } from './client/api';

// ─── Auth Client (vanilla JS) ────────────────────────────────────────────
export {
  AuthClient,
  AuthClientError,
  AuthSessionSynchronizationError,
  hasAnyAuthorizationPermission,
  hasAuthorizationPermission,
  hasEveryAuthorizationPermission,
  isAuthEmailVerificationRequiredResult,
  isAuthTenantOnboardingRequiredResult,
  isAuthTenantSelectionRequiredResult,
} from './client/auth-client';
export {
  normalizeAbsoluteLocalPath,
  normalizeConfiguredLocalPath,
} from '../auth/local-path';
export type {
  AuthAuthorizationScopeLifecycle,
  AuthClientOptions,
} from './client/auth-client';
export type {
  AuthApiKeyApplicationAdminSdkSurface,
  AuthApiKeyCreatedVia,
  AuthApiKeyIssueInput,
  AuthApiKeyListQuery,
  AuthApiKeyManagementCapabilities,
  AuthApiKeyPage,
  AuthApiKeyPlatformAdminSdkSurface,
  AuthApiKeyScopeKind,
  AuthApiKeySdkSurface,
  AuthApiKeySelfSdkSurface,
  AuthApiKeyStatus,
  AuthApiKeySummary,
  AuthApiKeyTenantAdminSdkSurface,
  AuthPlatformApiKeyListQuery,
  IssuedAuthApiKey,
} from './client/auth-api-key-types';

export type {
  AuthAuditActorProvenance,
  AuthAuditEvent,
  AuthAuditExport,
  AuthAuditMetadata,
  AuthAuditMetadataValue,
  AuthAuditOutcome,
  AuthAuditPage,
  AuthAuditPruneResult,
  AuthAuditQuery,
  AuthAuditReadScope,
  AuthAuditScopeKind,
  AuthAuditSdkSurface,
} from './client/auth-audit-types';
export type {
  AuthAuthorizationIdentitySnapshot,
  AuthAuthorizationScopeSnapshot,
  AuthAuthorizationSnapshot,
  AuthAuthorizationState,
  AuthAuthorizationStatus,
  AuthDomainOnboardingAdmissionResult,
  AuthDomainOnboardingCompletion,
  AuthDomainOnboardingPendingRequest,
  AuthDomainOnboardingStatus,
  AuthDomainOnboardingTenantSummary,
  AuthApplicationAdministrationConfig,
  AuthApplicationAdminSdkSurface,
  AuthApplicationOwnershipTransferResult,
  AuthApplicationRoleDescriptor,
  AuthApplicationRoleMutationResult,
  AuthApplicationUser,
  AuthApplicationUserIdentity,
  AuthApplicationUserListParams,
  AuthApplicationUserPage,
  AuthApplicationUserStatus,
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminMfaRequirement,
  AuthAdminMfaResetResult,
  AuthAdminSdkSurface,
  AuthAdminUpdateUserParams,
  AuthAdminUserMfaStatus,
  AuthAdminUserListParams,
  AuthAdminUserListResult,
  AuthCompletionResult,
  AuthEmailVerificationRequiredResult,
  AuthMfaChallenge,
  AuthMfaChallengeRequiredResult,
  AuthMfaMethod,
  AuthMfaMethodType,
  AuthMfaSetupRequiredResult,
  AuthMfaSetupStartResult,
  AuthMfaSetupVerifyResult,
  AuthPasswordUpdatedResult,
  AuthPublicConfig,
  AuthRegistrationResult,
  AuthRegistrationTenant,
  AuthSessionResult,
  AuthSessionTransitionOperation,
  AuthSessionTransitionState,
  AuthTenantListResult,
  AuthTenantCreateParams,
  AuthTenantDomainAdministration,
  AuthTenantDomainChallengeResult,
  AuthTenantDomainClaim,
  AuthTenantDomainClaimResult,
  AuthTenantDomainClaimStatus,
  AuthTenantDomainDnsChallenge,
  AuthTenantDomainPolicy,
  AuthTenantDomainPolicyUpdate,
  AuthTenantDomainReleaseInput,
  AuthTenantDomainReleaseResult,
  AuthTenantDomainRequestRole,
  AuthTenantOnboardingRequiredResult,
  AuthTenantSelectionRequiredResult,
  AuthTenantSummary,
  AuthTenantAddMemberParams,
  AuthTenantAdministrationConfig,
  AuthTenantMember,
  AuthTenantMemberIdentity,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantMembershipStatus,
  AuthTenantOwnershipTransferResult,
  AuthTenantRoleDescriptor,
  AuthTenantUpdateMemberParams,
  AuthTenantAcceptInvitationParams,
  AuthTenantInvitation,
  AuthTenantInvitationAcceptanceResult,
  AuthTenantInvitationInspection,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantInvitationStatus,
  AuthTenantIssueInvitationParams,
  AuthTenantIssueInvitationResult,
  AuthTenantDenyJoinRequestParams,
  AuthTenantJoinRequest,
  AuthTenantJoinRequestApprovalPolicy,
  AuthTenantJoinRequestApprovalRole,
  AuthTenantJoinRequestListParams,
  AuthTenantJoinRequestPage,
  AuthTenantJoinRequestRoleSelection,
  AuthTenantJoinRequestStatus,
  AuthTenantReviewJoinRequestParams,
  AuthUserPropertyConfig,
  AuthUser,
  RegisterParams,
} from './client/auth-client';
export type {
  AuthPlatformAddMemberParams,
  AuthPlatformAdministrationConfig,
  AuthPlatformAdminSdkSurface,
  AuthPlatformIssueInvitationParams,
  AuthPlatformMutableTenantStatus,
  AuthPlatformRoleSelection,
  AuthPlatformTenant,
  AuthPlatformTenantCreateParams,
  AuthPlatformTenantCreateResult,
  AuthPlatformTenantListParams,
  AuthPlatformTenantOwnershipTransferResult,
  AuthPlatformTenantPage,
  AuthPlatformTenantStatus,
  AuthPlatformTenantUpdateParams,
  AuthPlatformTenantUpdateResult,
  AuthPlatformUpdateMemberInput,
  AuthPlatformUpdateMemberParams,
} from './client/auth-client';

// ─── React: Providers ────────────────────────────────────────────────────
export { AppProvider } from './client/app-provider';
export type { AppProviderProps } from './client/app-provider';

// ─── React: Error Handling ──────────────────────────────────────────────
export { ErrorBoundary, NotFoundPage } from './client/error-boundary';
export {
  CompositeFrontendSink,
  ConsoleFrontendSink,
  HttpFrontendSink,
  FRONTEND_OBS_CODES,
  configureFrontendObservability,
  emitFrontendCode,
  emitFrontendEvent,
  getFrontendObservabilitySink,
} from './client/observability';
export type {
  FrontendObservabilityConfig,
  FrontendObservabilityEvent,
  FrontendObservabilitySink,
} from './client/observability';
export { ClientProvider } from './client/hooks';
export type { ClientProviderProps } from './client/hooks';
export { RouterProvider } from './client/router-context';

// ─── React: Hooks ────────────────────────────────────────────────────────
export {
  // Client
  useClient,
  useClientMaybe,
  useIsServer,
  isAuthorizationScopeCallbackCurrent,
  useAuthorizationScopeBoundary,
  useCollection,
  useLazyCollection,
  useDataPage,
  useDataSelection,
  useRow,
  useRecord,
  useRecordByIdentity,
  useResourceActions,
  useResourceClient,
  useResourceList,
  useResourceRecord,
  useQuery,
  useStatus,
  buildDataPageQuery,
  buildResourceListQuery,
  useConnectionHealth,
  useDataRealmReadiness,
  useDataStudio,
  useMutation,
  // Auth
  useAuth,
  useAuthApiKeys,
  useAuthorization,
  useAuthConfig,
  useCurrentUser,
  useRequireAuth,
  useUserProperty,
  useApplicationAccess,
  useAuthAudit,
  useHasAllPermissions,
  useHasAnyPermission,
  useHasPermission,
  useTenantMembers,
  usePlatformAdministration,
  usePlatformTenants,
  useTenantDomainAdministration,
  useDomainOnboarding,
  useTenantOnboardingAdministration,
  useTenantAppShellWorkspaces,
  useTenantSwitcher,
  // State (re-exported from sync/client)
  useFormDraft,
  usePreference,
  useServerState,
  useServerStateReady,
  // Router
  useParams,
  usePathname,
  useRouter,
} from './client/hooks';

export type {
  AuthState,
  AuthActions,
  UseAuthApiKeysOptions,
  UseAuthApiKeysResult,
  AuthorizationScopeBoundary,
  UseAuthorizationResult,
  AuthConfigState,
  AuthConfigStatus,
  UseUserPropertyOptions,
  UseUserPropertyResult,
  UseApplicationAccessOptions,
  UseApplicationAccessResult,
  UseAuthAuditOptions,
  UseAuthAuditResult,
  DataRealmReadinessControl,
  DataRealmReadinessUiStatus,
  UseDataRealmReadinessOptions,
  UseDataRealmReadinessResult,
  DataStudioAccess,
  DataStudioControllerStatus,
  UseDataStudioOptions,
  UseDataStudioResult,
  UseTenantMembersOptions,
  UseTenantMembersResult,
  UsePlatformAdministrationOptions,
  UsePlatformAdministrationResult,
  UsePlatformTenantsOptions,
  UsePlatformTenantsResult,
  UseTenantDomainAdministrationOptions,
  UseTenantDomainAdministrationResult,
  UseDomainOnboardingOptions,
  UseDomainOnboardingResult,
  UseTenantOnboardingAdministrationOptions,
  UseTenantOnboardingAdministrationResult,
  UseTenantAppShellWorkspacesOptions,
  UseTenantSwitcherResult,
  ConnectionHealth,
  LazyCollectionResult,
  LazyCollectionOptions,
  CollectionResult,
  DataFilterExpression,
  DataFilterOperator,
  DataFilterPrimitive,
  DataFilterValue,
  DataPageFilters,
  DataPageInfo,
  DataPageOptions,
  DataPageResult,
  DataPageSort,
  DataSelectionMode,
  IdentityRecordResult,
  RecordResult,
  ResourceActionsResult,
  ResourceListHookResult,
  ResourceRecordResult,
  UseResourceListOptions,
  UseResourceRecordOptions,
  UseDataSelectionOptions,
  UseDataSelectionReturn,
  UseFormDraftOptions,
  UseFormDraftResult,
  UseMutationOptions,
  UseMutationReturn,
  UsePreferenceResult,
} from './client/hooks';

// ─── React: Components ──────────────────────────────────────────────────
export { Link } from './client/link';
export type { LinkProps } from './client/link';

// ─── Default Animated Icons ─────────────────────────────────────────────
export {
  AnimateIcon,
  ZeroIcon,
  getZeroAnimatedIcon,
  hasZeroAnimatedIcon,
  resolveZeroAnimatedIcon,
  zeroAnimatedIconNames,
  zeroAnimatedIcons,
} from './icons';
export type {
  AnimateIconContextValue,
  AnimateIconProps,
  IconProps,
  IconWrapperProps,
  ZeroAnimatedIconComponent,
  ZeroAnimatedIconName,
  ZeroIconProps,
} from './icons';

// ─── Smooth Scroll-To-Bottom ────────────────────────────────────────────
export {
  StickToBottom,
  useStickToBottom,
  useStickToBottomContext,
} from 'use-stick-to-bottom';
export type {
  Animation,
  GetTargetScrollTop,
  ScrollElements,
  ScrollToBottom,
  ScrollToBottomOptions,
  SpringAnimation,
  StickToBottomContext,
  StickToBottomInstance,
  StickToBottomOptions,
  StickToBottomProps,
  StickToBottomState,
  StopScroll,
} from 'use-stick-to-bottom';

// ─── Toast ──────────────────────────────────────────────────────────────
export { Toaster } from '../components/ui/sonner';
export type { ToasterProps } from '../components/ui/sonner';
export { toast } from 'sonner';

// ─── QR Code ───────────────────────────────────────────────────────────
export { QRCode } from '../components/qr-code';
export type { QRCodeProps } from '../components/qr-code';

// ─── Client Router (for advanced use) ───────────────────────────────────
export {
  registerRoute,
  matchClientRoute,
  navigateTo,
  prefetchRoute,
} from './client/client-router';

// ─── Router Types ────────────────────────────────────────────────────────
export type {
  EffectiveRouteAuthRequirement,
  RouteAuthMode,
  RouteAuthRequirement,
} from './router/auth-policy';
export {
  isPublicPath,
  mergeRouteAuthRequirements,
  normalizeRouteAuthRequirement,
  resolveRouteAuthMode,
  shouldRequireAuthForRoute,
} from './router/auth-policy';

export type {
  RouteModule,
  RouteNode,
  MatchResult,
  LoaderContext,
  ApiHandler,
  PageMeta,
  RouterConfig,
  RouteConfig,
} from './router/types';

// ─── Forms ──────────────────────────────────────────────────────────────
export { AutoForm } from '../components/forms';
export { FieldRenderer } from '../components/forms';
export { Wizard } from '../components/forms';
export type { WizardProps, WizardStep } from '../components/forms';
export { useForm } from '../hooks/use-form';
export type { UseFormOptions, UseFormReturn } from '../hooks/use-form';

// ─── Data Table ─────────────────────────────────────────────────────────
export { DataTable, DataTableView } from '../components/data-table';
export { useDataTable, useDataTableSource, buildDataTableLazyQuery } from '../components/data-table';
export { DataTableColumnHeader } from '../components/data-table';
export { DataTableToolbar } from '../components/data-table';
export { DataTableControls } from '../components/data-table';
export { DataTableSearch } from '../components/data-table';
export { DataTablePagination } from '../components/data-table';
export { DataTableRowActions } from '../components/data-table';
export {
  DataTableBulkActions,
  DataTableServerSourceError,
  createDataTableApiAdapter,
  buildDataTableServerQuery,
  useDataTableMutationRunner,
} from '../components/data-table';
export type {
  DataTableCellContext,
  DataTableColumnOverride,
  DataTableColumnOverrides,
  DataTableFilters,
  DataTableFilterValue,
  DataTableInitialState,
  DataTableState,
  DataTablePaginationProps,
  DataTableServerAdapter,
  DataTableServerAdapterContext,
  DataTableServerCursorPage,
  DataTableServerOffsetPage,
  DataTableServerPage,
  DataTableServerPaginationMode,
  DataTableServerQuery,
  DataTableServerResult,
  DataTableServerSource,
  DataTableServerSourceErrorCode,
  DataTableBulkAction,
  DataTableBulkActionsProps,
  DataTablePageBulkSelection,
  DataTableAllMatchingBulkSelection,
  DataTableMutationContext,
  DataTableMutationRunner,
  DataTableProps,
  DataTableSearchOptions,
  DataTableSearchProps,
  DataTableSource,
  DataTableSourceActions,
  DataTableSourceState,
  DataTableToolbarContext,
  DataTableControlsProps,
  DataTableToolbarProps,
  DataTableToolbarSlot,
  DataTableToolbarSlots,
  RowAction,
  UseDataTableOptions,
  UseDataTableReturn,
  UseDataTableSourceOptions,
} from '../components/data-table';

// ─── Data Studio ────────────────────────────────────────────────────────
export {
  DataStudio,
  DataStudioFilterControl,
  DataStudioGrid,
  DataStudioInlineCell,
  DataStudioInspector,
  DataStudioToolbar,
  DataStudioWorkspace,
  resolveDataStudioCellKeyAction,
} from '../components/data-studio';
export type {
  DataStudioCellKeyAction,
  DataStudioCellSaveState,
  DataStudioFilterControlProps,
  DataStudioGridProps,
  DataStudioInlineCellProps,
  DataStudioInspectorProps,
  DataStudioProps,
  DataStudioToolbarProps,
  DataStudioWorkspaceProps,
} from '../components/data-studio';

// ─── Kanban Board ──────────────────────────────────────────────────────
export {
  KanbanBoard,
  KanbanTaskCard,
  groupKanbanItemIds,
  projectKanbanMove,
} from '../components/kanban';
export type {
  KanbanBoardProps,
  KanbanItemMove,
  KanbanTaskCardProps,
  KanbanTarget,
  ProjectKanbanMoveInput,
  ProjectKanbanMoveResult,
} from '../components/kanban';

// ─── Radial Context Menu ────────────────────────────────────────────────
export { RadialMenu } from '../components/radial-menu';
export type { RadialMenuItem, RadialMenuProps } from '../components/radial-menu';

// ─── Public Page Components ────────────────────────────────────────────
export { ResizableNavbar } from '../components/navbar';
export type {
  ResizableNavbarAction,
  ResizableNavbarBrand,
  ResizableNavbarItem,
  ResizableNavbarProps,
} from '../components/navbar';
export {
  Hero,
  HeroActions,
  HeroBackground,
  HeroImageBackground,
  WavyBackground,
} from '../components/hero';
export type {
  HeroAction,
  HeroBackgroundOptions,
  HeroBackgroundPreset,
  HeroImageBackgroundProps,
  HeroProps,
  WavyBackgroundProps,
} from '../components/hero';
export { CodeBlock } from '../components/code-block';
export { JsonEditor } from '../components/json-editor';
export type { JsonEditorProps, JsonEditorHandle, JsonEditorCommitResult } from '../components/json-editor';
export type {
  CodeBlockFile,
  CodeBlockProps,
  CodeBlockTheme,
} from '../components/code-block';
export { FeaturesSection } from '../components/features';
export type {
  FeatureSectionItem,
  FeaturesSectionProps,
} from '../components/features';
export { CtaSection } from '../components/cta';
export type { CtaSectionProps } from '../components/cta';
export { FooterSection } from '../components/footer';
export type {
  FooterSectionBrand,
  FooterSectionLink,
  FooterSectionProps,
} from '../components/footer';
export {
  FlipWords,
  TextGenerateEffect,
  TypewriterEffect,
} from '../components/text-effects';
export type {
  FlipWordsProps,
  TextGenerateEffectProps,
  TypewriterEffectProps,
  TypewriterWord,
} from '../components/text-effects';
export { StreamingText } from '../components/streaming-text';
export type {
  StreamSource,
  StreamingTextProps,
  StreamingTextStatus,
} from '../components/streaming-text';
export { SecretField } from '../components/secret-field';
export type { SecretFieldProps } from '../components/secret-field';
export { Faq } from '../components/faq';
export type { FaqItem, FaqProps } from '../components/faq';
export { ExpandableCards } from '../components/expandable-card';
export type {
  ExpandableCardItem,
  ExpandableCardsProps,
} from '../components/expandable-card';
export { BentoGrid, BentoGridItem, BentoGridSkeleton } from '../components/bento-grid';
export type {
  BentoGridColumns,
  BentoGridItemProps,
  BentoGridProps,
  BentoGridSpan,
} from '../components/bento-grid';
export { AnimatedList, AnimatedListCard, AnimatedListItem } from '../components/animated-list';
export type {
  AnimatedListCardProps,
  AnimatedListItemProps,
  AnimatedListProps,
} from '../components/animated-list';

// ─── App Shell ─────────────────────────────────────────────────────────
export {
  AppShell,
  AppShellHeader,
  AppShellBreadcrumbs,
  AppShellSidebar,
} from '../components/app-shell';
export type {
  AppShellProps,
  AppShellHeaderProps,
  AppShellBreadcrumbsProps,
  AppShellSidebarProps,
  AppShellPreset,
  AppShellIcon,
  AppShellBrand,
  AppShellBreadcrumb,
  AppShellWorkspace,
  AppShellWorkspaceConfig,
  AppShellMenuItem,
  AppShellNavItem,
  AppShellNavGroup,
  AppShellUser,
  AppShellHeaderConfig,
  AppShellThemeToggleConfig,
} from '../components/app-shell';
export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '../components/sidebar';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../components/dropdown-menu';
export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  useCollapsible,
} from '../components/collapsible';
export type {
  DropdownMenuProps,
  DropdownMenuTriggerProps,
  DropdownMenuContentProps,
  DropdownMenuGroupProps,
  DropdownMenuItemProps,
  DropdownMenuCheckboxItemProps,
  DropdownMenuRadioGroupProps,
  DropdownMenuRadioItemProps,
  DropdownMenuLabelProps,
  DropdownMenuSeparatorProps,
  DropdownMenuShortcutProps,
  DropdownMenuSubProps,
  DropdownMenuSubTriggerProps,
  DropdownMenuSubContentProps,
} from '../components/dropdown-menu';
export {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '../components/popover';
export type {
  PopoverCloseProps,
  PopoverContentProps,
  PopoverProps,
  PopoverTriggerProps,
} from '../components/popover';
export type {
  CollapsibleProps,
  CollapsibleTriggerProps,
  CollapsibleContentProps,
  CollapsibleContextType,
} from '../components/collapsible';

// ─── UI Components ──────────────────────────────────────────────────────
export { Button, buttonVariants } from '../components/ui/button';
export { Input } from '../components/ui/input';
export { Label } from '../components/ui/label';
export { Textarea } from '../components/ui/textarea';
export { Badge, badgeVariants } from '../components/ui/badge';
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card';
export {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectSeparator, SelectTrigger, SelectValue,
} from '../components/ui/select';
export {
  Table, TableBody, TableCaption, TableCell, TableFooter,
  TableHead, TableHeader, TableRow,
} from '../components/ui/table';
export { ScrollArea, ScrollBar } from '../components/ui/scroll-area';
export { Separator } from '../components/ui/separator';
export { Skeleton } from '../components/ui/skeleton';
export { Avatar, AvatarImage, AvatarFallback } from '../components/ui/avatar';
export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from '../components/ui/breadcrumb';
export {
  FormField, FormLabel, FormControl, FormDescription, FormMessage,
} from '../components/ui/form-field';
export {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from '../components/ui/pagination';

// ─── Calendar & Date ────────────────────────────────────────────────────
export { Calendar } from '../components/ui/calendar';
export type { CalendarProps } from '../components/ui/calendar';
export { DatePicker } from '../components/ui/date-picker';
export type { DatePickerCalendarProps, DatePickerProps } from '../components/ui/date-picker';
export { DateRangePicker } from '../components/ui/date-range-picker';
export type { DateRangePickerProps } from '../components/ui/date-range-picker';
export { TimePicker } from '../components/ui/time-picker';
export type { TimePickerProps } from '../components/ui/time-picker';

// ─── Command ────────────────────────────────────────────────────────────
export {
  Command, CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator, CommandShortcut,
} from '../components/ui/command';

// ─── Combobox ───────────────────────────────────────────────────────────
export { Combobox } from '../components/ui/combobox';
export type { ComboboxProps, ComboboxOption } from '../components/ui/combobox';

// Hierarchical single/multi selection with async levels and optional path chips.
export {
  Cascader, CascaderTrigger, CascaderContent, CascaderPanel, CascaderInput,
  CascaderBreadcrumb, CascaderValue, CascaderList, CascaderItems,
  CascaderFooter, CascaderAction, CascaderImportMenu, CascaderSelectionChips,
  useCascaderSelection,
} from '../components/cascader';
export type {
  CascaderProps, CascaderNode, CascaderSearchResult, CascaderSelection,
  CascaderChildrenLoader, CascaderSearchLoader, CascaderLoadError, CascaderImportAction,
} from '../components/cascader';

// ─── Tag Input ──────────────────────────────────────────────────────────
export { TagInput } from '../components/ui/tag-input';
export type { TagInputProps } from '../components/ui/tag-input';

// ─── Master-Detail ──────────────────────────────────────────────────────
export { MasterDetailPage, MasterDetailView } from '../components/master-detail';
export type {
  MasterDetailPageProps,
  MasterDetailRenderContext,
} from '../components/master-detail';

// ─── CRUD Page ──────────────────────────────────────────────────────────
export { CrudPage } from '../components/crud-page';
export type { CrudPageProps } from '../components/crud-page';

// ─── Stat Card ──────────────────────────────────────────────────────────
export { StatCard } from '../components/ui/stat-card';
export type { StatCardProps } from '../components/ui/stat-card';

// ─── Layout Components ──────────────────────────────────────────────────
export { ListDetailLayout } from '../components/ui/list-detail-layout';
export type { ListDetailLayoutProps } from '../components/ui/list-detail-layout';
export { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/ui/resizable';
export { DetailPanel } from '../components/ui/detail-panel';
export type { DetailPanelProps } from '../components/ui/detail-panel';
export { RecordNavigationBar } from '../components/ui/record-navigation-bar';
export type {
  RecordNavigationBarProps,
  NavigationAction,
  RecordPrimaryAction,
} from '../components/ui/record-navigation-bar';
export {
  InlineEditText,
  resolveInlineEditTextKeyAction,
} from '../components/ui/inline-edit-text';
export type {
  InlineEditTextKeyAction,
  InlineEditTextProps,
  InlineEditTextState,
} from '../components/ui/inline-edit-text';

// ─── Auth Blocks ────────────────────────────────────────────────────────
export {
  LoginForm, RegisterForm, ForgotPasswordForm, OTPVerification,
  PasswordActionForm, EmailVerificationForm, ChangePasswordForm, UserPropertiesForm,
  AuthFlowContinuation, TenantCreationForm, TenantSelectionForm,
  DataRealmReadinessNotice, DataRealmReadyGate,
  ApiKeyManagement, SelfApiKeyManagement, ApplicationUserApiKeyManagement,
  TenantMemberApiKeyManagement, PlatformApiKeyManagement,
  PlatformWorkspaceManagement,
  TenantSwitcher, TenantMemberManagement, TenantOnboardingManagement,
  TenantDomainManagement, DomainOnboarding, ControlPlaneAuditViewer,
  TenantInvitationForm, TenantJoinRequestForm,
  PasswordInput, PasswordStrength, OTPInput, SocialLoginGroup,
  AuthLayout, AuthHeader,
  AdminGate, AdministrationScopeGate, Gate, HasFlag, HasProperty,
  PermissionGate, PlatformAdminGate,
  PropertyGate, SignedIn, SignedOut, TenantGate,
  useGate, useNativeAuthContinuation, useNativeAuthRoute, useNativeLoginHint,
  usePropertyGate, useTenantInvitationAction,
} from '../components/auth';
export type {
  LoginFormProps, RegisterFormProps, ForgotPasswordFormProps,
  PasswordActionFormProps, EmailVerificationFormProps, ChangePasswordFormProps, UserPropertiesFormProps,
  AuthFlowContinuationProps, AuthFlowContinuationResult, TenantCreationFormProps,
  TenantSelectionFormProps,
  DataRealmReadinessNoticeProps, DataRealmReadyGateProps,
  ApiKeyManagementCommonProps, ApiKeyManagementProps,
  SelfApiKeyManagementProps, ApplicationUserApiKeyManagementProps,
  TenantMemberApiKeyManagementProps, PlatformApiKeyManagementProps,
  PlatformWorkspaceManagementProps,
  TenantSwitcherProps, TenantMemberManagementProps, TenantOnboardingManagementProps,
  UseTenantInvitationActionOptions, UseTenantInvitationActionResult,
  TenantDomainManagementProps, DomainOnboardingProps,
  ControlPlaneAuditViewerProps,
  TenantInvitationFormProps, TenantJoinRequestFormProps,
  OTPVerificationProps, SocialProvider,
  AdministrationScopeGateProps, AuthVisibilityGateProps, GateProps,
  HasFlagProps, PermissionGateProps,
  PlatformAdminGateProps, PropertyGateProps, PropertyGateValue, TenantGateProps,
} from '../components/auth';

// ─── Validation Primitives ──────────────────────────────────────────────
export { ValidationRules } from '../components/ui/validation-rules';
export type { ValidationRule, ValidationRulesProps } from '../components/ui/validation-rules';
export { ValidationMeter } from '../components/ui/validation-meter';
export type { ValidationMeterProps } from '../components/ui/validation-meter';

// ─── Notifications: Hooks ────────────────────────────────────────────────
export {
  useNotifications,
  useUnreadCount,
  useOnNewNotification,
} from './client/hooks';
export type {
  Notification,
  NotificationReceipt,
  NotificationWithStatus,
  UseNotificationsResult,
} from './client/hooks';

// ─── Rooms: Hooks ───────────────────────────────────────────────────────
export {
  useRoom,
  useRoomMembers,
  useRooms,
  useRoomActions,
  useRoomData,
  usePresence,
  usePresenceList,
  useTypingIndicator,
} from './client/hooks';
export type {
  UseRoomResult,
  RoomActions,
  PresenceMember,
  PresenceListMember,
  TypingIndicatorMember,
  UsePresenceResult,
  UsePresenceListOptions,
  UsePresenceListReturn,
  UseTypingIndicatorOptions,
  UseTypingIndicatorReturn,
} from './client/hooks';

// ─── Rooms: Config (types only — no bun:sqlite) ────────────────────────
export type {
  RoomRecord,
  RoomMemberRecord,
  RoomRole,
  CreateRoomParams,
} from '../rooms/types';

// ─── Ephemeral KV: Hooks ───────────────────────────────────────────────
export {
  useEphemeral,
  useEphemeralErrors,
  useEphemeralTopic,
} from './client/hooks';

// ─── Ephemeral KV: Client ──────────────────────────────────────────────
export { EphemeralClient } from '../sync/client/ephemeral-client';
export type {
  EphemeralChangeEvent,
  EphemeralErrorListener,
} from '../sync/client/ephemeral-client';
export type { EphemeralErrorMessage } from '../sync/ephemeral-policy';
export type { EphemeralEntryClient } from '../sync/client/ephemeral-store';

// ─── Notifications: Provider ─────────────────────────────────────────────
export { NotificationProvider, useNotificationContext } from './client/notification-provider';
export type { NotificationProviderProps } from './client/notification-provider';

// ─── Notifications: UI Components ────────────────────────────────────────
export { NotificationBadge } from '../components/ui/notification-badge';
export type { NotificationBadgeProps } from '../components/ui/notification-badge';
export { NotificationItem, formatRelativeTime } from '../components/ui/notification-item';
export type { NotificationItemProps, NotificationItemType } from '../components/ui/notification-item';
export { NotificationList } from '../components/ui/notification-list';
export type { NotificationListProps, NotificationListItem } from '../components/ui/notification-list';
export { NotificationDropdown } from '../components/ui/notification-dropdown';
export type { NotificationDropdownProps } from '../components/ui/notification-dropdown';
export { NotificationCenter } from '../components/ui/notification-center';
export type { NotificationCenterProps } from '../components/ui/notification-center';

// ─── Notifications: Config (types only) ─────────────────────────────────
export type {
  NotificationType,
  NotificationPriority,
  NotificationTarget,
} from '../notifications/types';

// ─── Workflows: React Hooks ────────────────────────────────────────────
export {
  useWorkflow,
  useWorkflowList,
  useWorkflowActions,
} from './client/workflow-hooks';
export type {
  UseWorkflowResult,
  UseWorkflowListResult,
  WorkflowActions,
  WorkflowInteractionSubmissionResult,
} from './client/workflow-hooks';
export { useWorkflowRun } from './client/hooks';
export type {
  UseWorkflowRunOptions,
  UseWorkflowRunResult,
  WorkflowProgress,
  WorkflowProgressCounts,
} from './client/hooks';
export { useWorkflowTopology } from './client/hooks';
export type { UseWorkflowTopologyResult } from './client/hooks';

// ─── Workflows: Types (no bun:sqlite — types.ts is clean) ──────────────
export type {
  WorkflowStatus,
  StepStatus,
  StepDefinition,
  WorkflowAccessRule,
  WorkflowDefinitionAccessPolicy,
  WorkflowDefinition,
  StepContext,
  StepHandler,
} from '../workflows/types';
export type {
  WorkflowPublicTopology,
  WorkflowPublicTopologyEdge,
  WorkflowPublicTopologyNode,
} from '../workflows/workflow-public-topology';

// ─── Storage: Hooks ─────────────────────────────────────────────────────
export {
  useUpload,
  useStorageFolder,
  useStorageDrives,
  useDriveCapabilities,
  useDriveUsage,
  useStoragePermissions,
  usePresignedUrl,
  useStorageActions,
} from '../storage/storage-hooks';
export type {
  UploadState,
  UseUploadReturn,
  UploadFileOptions,
  UseStorageFolderReturn,
  UseStorageDrivesReturn,
  UseDriveCapabilitiesReturn,
  UseDriveUsageReturn,
  UseStoragePermissionsReturn,
  UsePresignedUrlReturn,
  StorageActions,
} from '../storage/storage-hooks';
export { useUploadQueue } from '../storage/upload-queue-hooks';
export type {
  UploadQueueFilesOptions,
  UploadQueueItem,
  UploadQueueItemStatus,
  UseUploadQueueReturn,
} from '../storage/upload-queue-hooks';
export { useStorageFile } from '../storage/storage-file-hooks';
export type { UseStorageFileReturn } from '../storage/storage-file-hooks';
export { useUploadDropzone } from '../storage/upload-dropzone-hooks';
export type {
  UseUploadDropzoneOptions,
  UseUploadDropzoneReturn,
} from '../storage/upload-dropzone-hooks';
export {
  useDriveQuota,
  useStorageBrowser,
} from '../storage/storage-browser-hooks';
export type {
  StorageBrowserActions,
  UseDriveQuotaReturn,
  UseStorageBrowserReturn,
} from '../storage/storage-browser-hooks';

// ─── Storage: Types (client-safe) ───────────────────────────────────────
export { STORAGE_TABLES } from '../storage/types';
export type {
  FileInfo,
  DriveRecord,
  DriveRecordWithAccess,
  DriveUsage,
  ObjectType,
  CreateDriveParams,
  CreateUploadGrantParams,
  GrantPermissionParams,
  UploadOptions,
  StorageAccessCapabilities,
  StorageUploadGrant,
  PermissionRecord,
  ListOptions,
  ListPermissionsOptions,
  ListResult,
  GrantType,
  PermissionLevel,
} from '../storage/types';
export type {
  StorageStudioCapabilities,
  StorageStudioControlCapabilities,
  StorageStudioDrive,
  StorageStudioDriveListRequest,
  StorageStudioDrivePage,
  StorageStudioDriveProfileView,
  StorageStudioDriveUpdateRequest,
  StorageStudioJobPage,
  StorageStudioJobView,
  StorageStudioLifecycleRequest,
  StorageStudioMutationReceipt,
  StorageStudioProvisionRequest,
} from '../storage/storage-studio-contracts';

// ─── Admin Components ───────────────────────────────────────────────────
export {
  IdentityUserManagement,
  PlatformUserManagement,
  UserManagement,
  useAdminUsers,
} from '../components/admin/users';
export type {
  PlatformUserManagementProps,
  UseAdminUsersOptions,
  UseAdminUsersResult,
  UserManagementCreateResult,
  UserManagementFilters,
  UserManagementProps,
  UserManagementStatusFilter,
  UserManagementUser,
  UserRoleOption,
} from '../components/admin/users';
export {
  StorageManagement,
  StorageStudioManagement,
  StorageDriveList,
  StorageDriveDetail,
  StorageDrivePermissionsPanel,
  StorageObjectPermissionsPanel,
  StorageDriveSettingsPanel,
  StorageDropzone,
  StorageFileBrowser,
  StorageDriveDetailHeader,
  StorageFileDetailPanel,
  StorageFilePreview,
  StorageStudioWorkspace,
  StorageStudioToolbar,
  StorageStudioList,
  StorageStudioInspector,
  StorageStudioActionBar,
  StorageStudioPaginationControls,
  useStorageStudioManagement,
  useStorageFilePreview,
} from '../components/storage';
export type {
  StorageManagementProps,
  StorageStudioManagementProps,
  StorageManagementView,
  StorageDriveRow,
  StorageDriveListProps,
  StorageDriveDetailProps,
  StorageDrivePermissionsPanelProps,
  StorageObjectPermissionsPanelProps,
  StorageDriveSettingsPanelProps,
  StorageDropzoneProps,
  StorageFileBrowserProps,
  StorageDriveDetailHeaderProps,
  StorageFileDetailPanelProps,
  StorageFilePreviewProps,
  StorageFilePreviewKind,
  StorageFilePreviewState,
  StorageStudioWorkspaceProps,
  StorageStudioToolbarProps,
  StorageStudioListProps,
  StorageStudioInspectorProps,
  StorageStudioActionBarProps,
  StorageManagementController,
  StorageStudioBreadcrumb,
  StorageStudioFilters,
  StorageStudioInspectorSlots,
  StorageStudioJobPresentation,
  StorageStudioLifecycleFilter,
  StorageStudioOperations,
  StorageStudioOwnerFilter,
  StorageStudioPagination,
  UseStorageStudioManagementOptions,
  UseStorageStudioManagementResult,
} from '../components/storage';

// ─── Hooks ──────────────────────────────────────────────────────────────
export {
  ConfirmProvider,
  useAsyncAction,
  useAutoHeight,
  useConfirm,
  useControlledState,
  useDataState,
  useDebouncedCallback,
  useDebouncedValue,
  useDisclosure,
  useClickAway,
  useCopyToClipboard,
  useHotkey,
  useIdle,
  useInterval,
  useIsInView,
  useIsMobile,
  useMediaQuery,
  useMounted,
  useMotionValueState,
  getOS,
  useOs,
  usePrevious,
  useStableCallback,
  useTextSelection,
  useThrottledCallback,
  useThrottledValue,
  useTimeout,
} from '../hooks';
export type {
  AutoHeightOptions,
  ClickAwayEvent,
  CommonControlledStateProps,
  ConfirmOptions,
  DataStateValue,
  HotkeyHandler,
  HotkeyOptions,
  OperatingSystem,
  OSDetectionInput,
  UseAsyncActionOptions,
  UseAsyncActionReturn,
  UseClickAwayOptions,
  UseCopyToClipboardOptions,
  UseCopyToClipboardReturn,
  UseDebouncedCallbackOptions,
  UseDebouncedCallbackReturn,
  UseDisclosureOptions,
  UseDisclosureReturn,
  UseIdleOptions,
  UseIntervalOptions,
  UseIsInViewOptions,
  UseMediaQueryOptions,
  UseOsOptions,
  UseOsReturnValue,
  UseThrottledCallbackOptions,
  UseThrottledCallbackReturn,
  UseThrottledValueOptions,
} from '../hooks';

// ─── Theme ──────────────────────────────────────────────────────────────
export { ThemeProvider } from '../components/ui/theme-provider';
export type { ThemeProviderProps } from '../components/ui/theme-provider';
export { ThemeTogglerButton } from '../components/animate-ui/components/buttons/theme-toggler';
export type { ThemeTogglerButtonProps } from '../components/animate-ui/components/buttons/theme-toggler';

// ─── Modal Manager ──────────────────────────────────────────────────────
export { ModalManager, modals, HoldButton } from '../modals';
export type { ModalManagerProps } from '../modals';
export type {
  ModalSize,
  ModalType,
  ModalOverflow,
  ModalCustomSize,
  ModalInstance,
  ConfirmModalOptions,
  OpenModalOptions,
  OpenConfirmOptions,
  HoldButtonProps,
} from '../modals';
