---
id: zero.inventory.catalog.frontend-hooks
type: inventory
audience: [agent, maintainer]
owner: frontend-runtime
status: draft
visibility: internal
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Individually Exported Frontend Hooks

[Catalog index](./index.md) · [Documentation index](../../../index.md)

## Baseline And Counting Rules

Static inspection of committed `main` source for framework 2.1.1, not an installed-artifact qualification. These records distinguish named exports from source-local helpers; no app module, environment file, database, Doctor, test suite, or provider was executed. Import alternatives are grouped in one row; aliases and same-name symbols backed by different modules retain separate rows. Package routes come from [package.json](../../../../package.json) and transitive local re-exports; third-party entries retain their external origin. Source links point to repo files; the label records the inspected declaration line, not a Markdown anchor. Planned guide paths are relative to `docs-next/` and deliberately plain text. All rows remain draft/source-observed; supported source/local surfaces still need exact-package qualification and mode-sensitive behavior review.

This catalog contains **131 named hook export records**. `useQuery` and `useRow` each have distinct app-SDK and lower-level Sync implementations and are not merged by name. Generic `@zero/framework/hooks` does not export `useForm`; it is exported by the root/react barrel.

## Independent Catalog Reconciliation

Reviewed independently on 2026-10-05. The three public frontend runtime-symbol catalogs contain **639 records** (414 component, 131 hook, 94 support records). All **1,469 listed import alternatives** reconcile with the pinned package-export manifest: no missing route or named symbol was found. This is static manifest/source coverage, not installed-artifact execution or complete per-component browser verification. Canonical destinations for provider/scope/router/form/data-control features were reconciled with their owning inventories; aliases still preserve source identity. Approved dirty-working-tree defect corrections are recorded in those inventories rather than retroactively relabeling the original clean baseline as shipped support.

## Symbol Coverage

### Authorized Working-Source Additions

This row describes the unreleased Cascader addition on top of Zero 2.2.1; it is
not part of the original clean-baseline hook count.

| Named symbol | Exact import alternatives | Declaration evidence | Canonical guide |
| --- | --- | --- | --- |
| `useCascaderSelection` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/cascader` | [src/components/cascader/cascader-context.ts](../../../../src/components/cascader/cascader-context.ts) | [Cascader](../../../frontend/components/cascader.md#full-path-chips-and-custom-summaries) |
| `useSignaturePad` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/signature-pad` | [src/components/signature-pad/signature-pad-context.ts](../../../../src/components/signature-pad/signature-pad-context.ts) | [Signature Pad](../../../frontend/components/signature-pad.md#drawing-state-api-and-export-configuration) |

### Original Baseline

| Named symbol | Exact import alternatives | Declaration evidence | Canonical planned guide |
| --- | --- | --- | --- |
| `useAdminUsers` | `@zero/framework`, `@zero/framework/react` | [src/components/admin/users/use-admin-users.ts:16](../../../../src/components/admin/users/use-admin-users.ts) | [frontend/guardian/management-hooks.md](../../../frontend/guardian/management-hooks.md) |
| `useSidebar` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/sidebar` | [src/components/animate-ui/components/radix/sidebar.tsx:52](../../../../src/components/animate-ui/components/radix/sidebar.tsx) | `frontend/components/overlays/sidebar-state.md` |
| `useAnimateIconContext` | `@zero/framework/icons` | [src/components/animate-ui/icons/icon.tsx:96](../../../../src/components/animate-ui/icons/icon.tsx) | `frontend/design-system/icon-animation.md` |
| `useCollapsible` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/collapsible` | [src/components/animate-ui/primitives/radix/collapsible.tsx:15](../../../../src/components/animate-ui/primitives/radix/collapsible.tsx) | `frontend/components/overlays/collapsible.md` |
| `useGate` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/auth` | [src/components/auth/gate.tsx:58](../../../../src/components/auth/gate.tsx) | [frontend/guardian/authorization-gates.md](../../../frontend/guardian/authorization-gates.md) |
| `usePropertyGate` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/auth` | [src/components/auth/gate.tsx:71](../../../../src/components/auth/gate.tsx) | [frontend/guardian/authorization-gates.md](../../../frontend/guardian/authorization-gates.md) |
| `useNativeAuthContinuation` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/auth` | [src/components/auth/use-native-auth-route.ts:7](../../../../src/components/auth/use-native-auth-route.ts) | [frontend/guardian/native-ui.md](../../../frontend/guardian/native-ui.md) |
| `useNativeAuthRoute` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/auth` | [src/components/auth/use-native-auth-route.ts:18](../../../../src/components/auth/use-native-auth-route.ts) | [frontend/guardian/native-ui.md](../../../frontend/guardian/native-ui.md) |
| `useNativeLoginHint` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/auth` | [src/components/auth/use-native-auth-route.ts:35](../../../../src/components/auth/use-native-auth-route.ts) | [frontend/guardian/native-ui.md](../../../frontend/guardian/native-ui.md) |
| `useTenantInvitationAction` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/auth` | [src/components/auth/use-tenant-invitation-action.tsx:45](../../../../src/components/auth/use-tenant-invitation-action.tsx) | [frontend/guardian/onboarding-controls.md](../../../frontend/guardian/onboarding-controls.md) |
| `useDataTableSource` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/data-table` | [src/components/data-table/data-table-source.ts:146](../../../../src/components/data-table/data-table-source.ts) | `frontend/data-controls/data-table/sources.md` |
| `useDataTableMutationRunner` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/data-table` | [src/components/data-table/use-data-table-mutation.ts:44](../../../../src/components/data-table/use-data-table-mutation.ts) | `frontend/data-controls/data-table/actions.md` |
| `useDataTable` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/data-table` | [src/components/data-table/use-data-table.ts:102](../../../../src/components/data-table/use-data-table.ts) | `frontend/data-controls/data-table/state-and-columns.md` |
| `useStorageFilePreview` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks`, `@zero/framework/components/storage` | [src/components/storage/use-storage-file-preview.ts:37](../../../../src/components/storage/use-storage-file-preview.ts) | `frontend/storage/use-storage-file-preview.md` |
| `useStorageStudioManagement` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks`, `@zero/framework/components/storage` | [src/components/storage/use-storage-studio-management.tsx:61](../../../../src/components/storage/use-storage-studio-management.tsx) | `frontend/storage/use-storage-studio-management.md` |
| `useChart` | `@zero/framework/components/ui/chart` | [src/components/ui/chart.tsx:26](../../../../src/components/ui/chart.tsx) | `frontend/components/primitives/charts.md` |
| `useFormFieldContext` | `@zero/framework/components/ui/form-field` | [src/components/ui/form-field.tsx:16](../../../../src/components/ui/form-field.tsx) | `frontend/forms/field-context.md` |
| `useApplicationAccess` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/application-administration-hooks.ts:76](../../../../src/frontend/client/application-administration-hooks.ts) | [frontend/guardian/management-hooks.md](../../../frontend/guardian/management-hooks.md) |
| `useAuthApiKeys` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/auth-api-key-hooks.ts:63](../../../../src/frontend/client/auth-api-key-hooks.ts) | [frontend/guardian/api-key-controls.md](../../../frontend/guardian/api-key-controls.md) |
| `useAuthAudit` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/auth-audit-hooks.ts:41](../../../../src/frontend/client/auth-audit-hooks.ts) | [frontend/guardian/audit-controls.md](../../../frontend/guardian/audit-controls.md) |
| `useAuth` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/auth-hooks.ts:213](../../../../src/frontend/client/auth-hooks.ts) | [frontend/guardian/auth-hooks.md](../../../frontend/guardian/auth-hooks.md) |
| `useAuthConfig` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/auth-hooks.ts:587](../../../../src/frontend/client/auth-hooks.ts) | [frontend/guardian/auth-hooks.md](../../../frontend/guardian/auth-hooks.md) |
| `useCurrentUser` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/auth-hooks.ts:654](../../../../src/frontend/client/auth-hooks.ts) | [frontend/guardian/auth-hooks.md](../../../frontend/guardian/auth-hooks.md) |
| `useRequireAuth` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/auth-hooks.ts:665](../../../../src/frontend/client/auth-hooks.ts) | [frontend/guardian/auth-hooks.md](../../../frontend/guardian/auth-hooks.md) |
| `useUserProperty` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/auth-hooks.ts:713](../../../../src/frontend/client/auth-hooks.ts) | [frontend/guardian/auth-hooks.md](../../../frontend/guardian/auth-hooks.md) |
| `useAuthorization` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/authorization-hooks.ts:51](../../../../src/frontend/client/authorization-hooks.ts) | [frontend/guardian/authorization-gates.md](../../../frontend/guardian/authorization-gates.md) |
| `useHasAllPermissions` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/authorization-hooks.ts:119](../../../../src/frontend/client/authorization-hooks.ts) | [frontend/guardian/authorization-gates.md](../../../frontend/guardian/authorization-gates.md) |
| `useHasAnyPermission` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/authorization-hooks.ts:126](../../../../src/frontend/client/authorization-hooks.ts) | [frontend/guardian/authorization-gates.md](../../../frontend/guardian/authorization-gates.md) |
| `useHasPermission` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/authorization-hooks.ts:112](../../../../src/frontend/client/authorization-hooks.ts) | [frontend/guardian/authorization-gates.md](../../../frontend/guardian/authorization-gates.md) |
| `useAuthorizationScopeBoundary` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/authorization-scope-hooks.ts:102](../../../../src/frontend/client/authorization-scope-hooks.ts) | `frontend/runtime/authorization-scope-boundary.md` |
| `useClient` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/client-context.tsx:50](../../../../src/frontend/client/client-context.tsx) | `frontend/runtime/client-provider.md` |
| `useClientMaybe` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/client-context.tsx:64](../../../../src/frontend/client/client-context.tsx) | `frontend/runtime/client-provider.md` |
| `useIsServer` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/client-context.tsx:40](../../../../src/frontend/client/client-context.tsx) | `frontend/runtime/client-provider.md` |
| `useConnectionHealth` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/connection-health-hooks.ts:60](../../../../src/frontend/client/connection-health-hooks.ts) | `frontend/sdk/mutations-and-connection.md` |
| `useDataPage` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-page-hooks.ts](../../../../src/frontend/client/data-page-hooks.ts) | `frontend/sdk/data-composition.md` |
| `useRecord` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-composition-hooks.ts:304](../../../../src/frontend/client/data-composition-hooks.ts) | `frontend/sdk/data-composition.md` |
| `useRecordByIdentity` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-composition-hooks.ts:342](../../../../src/frontend/client/data-composition-hooks.ts) | `frontend/sdk/data-composition.md` |
| `useCollection` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-hooks.ts:54](../../../../src/frontend/client/data-hooks.ts) | `frontend/sdk/data-hooks.md` |
| `useLazyCollection` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-hooks.ts:145](../../../../src/frontend/client/data-hooks.ts) | `frontend/sdk/data-hooks.md` |
| `useQuery` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-hooks.ts:316](../../../../src/frontend/client/data-hooks.ts) | `frontend/sdk/data-hooks.md` |
| `useRow` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-hooks.ts:287](../../../../src/frontend/client/data-hooks.ts) | `frontend/sdk/data-hooks.md` |
| `useStatus` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-hooks.ts:354](../../../../src/frontend/client/data-hooks.ts) | `frontend/sdk/data-hooks.md` |
| `useDataRealmReadiness` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-realm-readiness-hooks.ts:72](../../../../src/frontend/client/data-realm-readiness-hooks.ts) | `frontend/sdk/scoped-control-planes.md` |
| `useDataSelection` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-selection-hooks.ts:52](../../../../src/frontend/client/data-selection-hooks.ts) | `frontend/sdk/data-composition.md` |
| `useDataStudio` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/data-studio-controller.ts:30](../../../../src/frontend/client/data-studio-controller.ts) | `frontend/data-studio/controller.md` |
| `useDomainOnboarding` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/domain-onboarding-hooks.ts:283](../../../../src/frontend/client/domain-onboarding-hooks.ts) | [frontend/guardian/onboarding-controls.md](../../../frontend/guardian/onboarding-controls.md) |
| `useTenantDomainAdministration` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/domain-onboarding-hooks.ts:52](../../../../src/frontend/client/domain-onboarding-hooks.ts) | [frontend/guardian/onboarding-controls.md](../../../frontend/guardian/onboarding-controls.md) |
| `useMutation` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/mutation-hooks.ts:38](../../../../src/frontend/client/mutation-hooks.ts) | `frontend/sdk/mutations-and-connection.md` |
| `useNotifications` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/notification-hooks.ts:89](../../../../src/frontend/client/notification-hooks.ts) | `frontend/notifications/hooks.md` |
| `useOnNewNotification` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/notification-hooks.ts:231](../../../../src/frontend/client/notification-hooks.ts) | `frontend/notifications/hooks.md` |
| `useUnreadCount` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/notification-hooks.ts:218](../../../../src/frontend/client/notification-hooks.ts) | `frontend/notifications/hooks.md` |
| `useNotificationContext` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/notification-provider.tsx:29](../../../../src/frontend/client/notification-provider.tsx) | `frontend/notifications/components.md` |
| `usePlatformAdministration` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/platform-administration-hooks.ts:41](../../../../src/frontend/client/platform-administration-hooks.ts) | [frontend/guardian/management-hooks.md](../../../frontend/guardian/management-hooks.md) |
| `usePlatformTenants` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/platform-tenant-directory-hooks.ts:98](../../../../src/frontend/client/platform-tenant-directory-hooks.ts) | [frontend/guardian/management-hooks.md](../../../frontend/guardian/management-hooks.md) |
| `useFormDraft` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/preference-hooks.ts:81](../../../../src/frontend/client/preference-hooks.ts) | `frontend/state/form-drafts.md` |
| `usePreference` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/preference-hooks.ts:35](../../../../src/frontend/client/preference-hooks.ts) | `frontend/state/form-drafts.md` |
| `usePresenceList` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/presence-list-hooks.ts:45](../../../../src/frontend/client/presence-list-hooks.ts) | `frontend/rooms/presence.md` |
| `useResourceActions` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/resource-hooks.ts:534](../../../../src/frontend/client/resource-hooks.ts) | `frontend/sdk/resource-hooks.md` |
| `useResourceClient` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/resource-hooks.ts:109](../../../../src/frontend/client/resource-hooks.ts) | `frontend/sdk/resource-hooks.md` |
| `useResourceList` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/resource-hooks.ts:161](../../../../src/frontend/client/resource-hooks.ts) | `frontend/sdk/resource-hooks.md` |
| `useResourceRecord` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/resource-hooks.ts:365](../../../../src/frontend/client/resource-hooks.ts) | `frontend/sdk/resource-hooks.md` |
| `usePresence` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/room-hooks.ts:197](../../../../src/frontend/client/room-hooks.ts) | `frontend/rooms/hooks.md` |
| `useRoom` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/room-hooks.ts:28](../../../../src/frontend/client/room-hooks.ts) | `frontend/rooms/hooks.md` |
| `useRoomActions` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/room-hooks.ts:89](../../../../src/frontend/client/room-hooks.ts) | `frontend/rooms/hooks.md` |
| `useRoomData` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/room-hooks.ts:155](../../../../src/frontend/client/room-hooks.ts) | `frontend/rooms/hooks.md` |
| `useRoomMembers` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/room-hooks.ts:45](../../../../src/frontend/client/room-hooks.ts) | `frontend/rooms/hooks.md` |
| `useRooms` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/room-hooks.ts:58](../../../../src/frontend/client/room-hooks.ts) | `frontend/rooms/hooks.md` |
| `useParams` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/router-context.tsx:106](../../../../src/frontend/client/router-context.tsx) | `frontend/router/provider-and-hooks.md` |
| `usePathname` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/router-context.tsx:112](../../../../src/frontend/client/router-context.tsx) | `frontend/router/provider-and-hooks.md` |
| `useRouter` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/router-context.tsx:125](../../../../src/frontend/client/router-context.tsx) | `frontend/router/provider-and-hooks.md` |
| `useTenantMembers` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/tenant-member-hooks.ts:50](../../../../src/frontend/client/tenant-member-hooks.ts) | [frontend/guardian/management-hooks.md](../../../frontend/guardian/management-hooks.md) |
| `useTenantOnboardingAdministration` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/tenant-onboarding-hooks.ts:98](../../../../src/frontend/client/tenant-onboarding-hooks.ts) | [frontend/guardian/management-hooks.md](../../../frontend/guardian/management-hooks.md) |
| `useTenantAppShellWorkspaces` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/tenant-switch-presentation.ts:287](../../../../src/frontend/client/tenant-switch-presentation.ts) | [frontend/guardian/tenant-switching.md](../../../frontend/guardian/tenant-switching.md) |
| `useTenantSwitcher` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/tenant-switcher-hooks.ts:28](../../../../src/frontend/client/tenant-switcher-hooks.ts) | [frontend/guardian/tenant-switching.md](../../../frontend/guardian/tenant-switching.md) |
| `useTypingIndicator` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/typing-indicator-hooks.ts:95](../../../../src/frontend/client/typing-indicator-hooks.ts) | `frontend/rooms/presence.md` |
| `useWorkflow` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/workflow-hooks.ts:88](../../../../src/frontend/client/workflow-hooks.ts) | `frontend/torrent/hooks.md` |
| `useWorkflowActions` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/workflow-hooks.ts:237](../../../../src/frontend/client/workflow-hooks.ts) | `frontend/torrent/hooks.md` |
| `useWorkflowList` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/workflow-hooks.ts:205](../../../../src/frontend/client/workflow-hooks.ts) | `frontend/torrent/hooks.md` |
| `useWorkflowRun` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/workflow-run-hooks.ts:75](../../../../src/frontend/client/workflow-run-hooks.ts) | `frontend/torrent/hooks.md` |
| `useWorkflowTopology` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/workflow-topology-hooks.ts:42](../../../../src/frontend/client/workflow-topology-hooks.ts) | `frontend/torrent/visualization.md` |
| `useAsyncAction` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-async-action.ts:34](../../../../src/hooks/use-async-action.ts) | `frontend/hooks/state-and-actions.md` |
| `useAutoHeight` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-auto-height.tsx:23](../../../../src/hooks/use-auto-height.tsx) | `frontend/hooks/browser-interactions.md` |
| `useClickAway` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-click-away.ts:36](../../../../src/hooks/use-click-away.ts) | `frontend/hooks/browser-interactions.md` |
| `useConfirm` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-confirm.tsx:109](../../../../src/hooks/use-confirm.tsx) | `frontend/hooks/confirmation.md` |
| `useControlledState` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-controlled-state.tsx:23](../../../../src/hooks/use-controlled-state.tsx) | `frontend/hooks/state-and-actions.md` |
| `useCopyToClipboard` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-copy-to-clipboard.ts:69](../../../../src/hooks/use-copy-to-clipboard.ts) | `frontend/hooks/browser-interactions.md` |
| `useDataState` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-data-state.tsx:27](../../../../src/hooks/use-data-state.tsx) | `frontend/hooks/state-and-actions.md` |
| `useDebouncedCallback` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-debounced-callback.ts:48](../../../../src/hooks/use-debounced-callback.ts) | `frontend/hooks/timing.md` |
| `useDebouncedValue` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-debounced-value.ts:17](../../../../src/hooks/use-debounced-value.ts) | `frontend/hooks/timing.md` |
| `useDisclosure` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-disclosure.ts:33](../../../../src/hooks/use-disclosure.ts) | `frontend/hooks/state-and-actions.md` |
| `useForm` | `@zero/framework`, `@zero/framework/react` | [src/hooks/use-form.ts:74](../../../../src/hooks/use-form.ts) | `frontend/forms/use-form.md` |
| `useHotkey` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-hotkey.ts:72](../../../../src/hooks/use-hotkey.ts) | `frontend/hooks/browser-interactions.md` |
| `useIdle` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-idle.ts:37](../../../../src/hooks/use-idle.ts) | `frontend/hooks/timing.md` |
| `useInterval` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-interval.ts:21](../../../../src/hooks/use-interval.ts) | `frontend/hooks/timing.md` |
| `useIsInView` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-is-in-view.tsx:22](../../../../src/hooks/use-is-in-view.tsx) | `frontend/hooks/browser-interactions.md` |
| `useMediaQuery` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-media-query.ts:31](../../../../src/hooks/use-media-query.ts) | `frontend/hooks/browser-interactions.md` |
| `useIsMobile` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-mobile.ts:16](../../../../src/hooks/use-mobile.ts) | `frontend/hooks/browser-interactions.md` |
| `useMotionValueState` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-motion-value-state.tsx:16](../../../../src/hooks/use-motion-value-state.tsx) | `frontend/hooks/browser-interactions.md` |
| `useMounted` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-mounted.ts:16](../../../../src/hooks/use-mounted.ts) | `frontend/hooks/state-and-actions.md` |
| `useOs` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-os.ts:92](../../../../src/hooks/use-os.ts) | `frontend/hooks/browser-interactions.md` |
| `usePrevious` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-previous.ts:15](../../../../src/hooks/use-previous.ts) | `frontend/hooks/state-and-actions.md` |
| `useStableCallback` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-stable-callback.ts:19](../../../../src/hooks/use-stable-callback.ts) | `frontend/hooks/state-and-actions.md` |
| `useTextSelection` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-text-selection.ts:29](../../../../src/hooks/use-text-selection.ts) | `frontend/hooks/browser-interactions.md` |
| `useThrottledCallback` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-throttled-callback.ts:36](../../../../src/hooks/use-throttled-callback.ts) | `frontend/hooks/timing.md` |
| `useThrottledValue` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-throttled-value.ts:20](../../../../src/hooks/use-throttled-value.ts) | `frontend/hooks/timing.md` |
| `useTimeout` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-timeout.ts:16](../../../../src/hooks/use-timeout.ts) | `frontend/hooks/timing.md` |
| `useDriveQuota` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-browser-hooks.ts:289](../../../../src/storage/storage-browser-hooks.ts) | `frontend/storage/storage-browser-hooks.md` |
| `useStorageBrowser` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-browser-hooks.ts:87](../../../../src/storage/storage-browser-hooks.ts) | `frontend/storage/storage-browser-hooks.md` |
| `useStorageFile` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-file-hooks.ts:38](../../../../src/storage/storage-file-hooks.ts) | `frontend/storage/storage-file-hooks.md` |
| `useDriveCapabilities` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-hooks.ts:629](../../../../src/storage/storage-hooks.ts) | `frontend/storage/storage-hooks.md` |
| `useDriveUsage` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-hooks.ts:819](../../../../src/storage/storage-hooks.ts) | `frontend/storage/storage-hooks.md` |
| `usePresignedUrl` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-hooks.ts:897](../../../../src/storage/storage-hooks.ts) | `frontend/storage/storage-hooks.md` |
| `useStorageActions` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-hooks.ts:944](../../../../src/storage/storage-hooks.ts) | `frontend/storage/storage-hooks.md` |
| `useStorageDrives` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-hooks.ts:565](../../../../src/storage/storage-hooks.ts) | `frontend/storage/storage-hooks.md` |
| `useStorageFolder` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-hooks.ts:441](../../../../src/storage/storage-hooks.ts) | `frontend/storage/storage-hooks.md` |
| `useStoragePermissions` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-hooks.ts:727](../../../../src/storage/storage-hooks.ts) | `frontend/storage/storage-hooks.md` |
| `useUpload` | `@zero/framework`, `@zero/framework/react` | [src/storage/storage-hooks.ts:302](../../../../src/storage/storage-hooks.ts) | `frontend/storage/storage-hooks.md` |
| `useUploadDropzone` | `@zero/framework`, `@zero/framework/react` | [src/storage/upload-dropzone-hooks.ts:66](../../../../src/storage/upload-dropzone-hooks.ts) | `frontend/storage/upload-dropzone-hooks.md` |
| `useUploadQueue` | `@zero/framework`, `@zero/framework/react` | [src/storage/upload-queue-hooks.ts:89](../../../../src/storage/upload-queue-hooks.ts) | `frontend/storage/upload-queue-hooks.md` |
| `useEphemeral` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks`, `@zero/framework/sync/client` | [src/sync/client/ephemeral-hooks.ts:72](../../../../src/sync/client/ephemeral-hooks.ts) | `frontend/state/ephemeral.md` |
| `useEphemeralErrors` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks`, `@zero/framework/sync/client` | [src/sync/client/ephemeral-hooks.ts:32](../../../../src/sync/client/ephemeral-hooks.ts) | `frontend/state/ephemeral.md` |
| `useEphemeralTopic` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks`, `@zero/framework/sync/client` | [src/sync/client/ephemeral-hooks.ts:151](../../../../src/sync/client/ephemeral-hooks.ts) | `frontend/state/ephemeral.md` |
| `useQuery` | `@zero/framework/sync/client` | [src/sync/client/hooks.ts:347](../../../../src/sync/client/hooks.ts) | `frontend/sdk/low-level-sync.md` |
| `useRow` | `@zero/framework/sync/client` | [src/sync/client/hooks.ts:282](../../../../src/sync/client/hooks.ts) | `frontend/sdk/low-level-sync.md` |
| `useSyncClient` | `@zero/framework/sync/client` | [src/sync/client/hooks.ts:152](../../../../src/sync/client/hooks.ts) | `frontend/sdk/low-level-sync.md` |
| `useSyncStatus` | `@zero/framework/sync/client` | [src/sync/client/hooks.ts:402](../../../../src/sync/client/hooks.ts) | `frontend/sdk/low-level-sync.md` |
| `useTable` | `@zero/framework/sync/client` | [src/sync/client/hooks.ts:199](../../../../src/sync/client/hooks.ts) | `frontend/sdk/low-level-sync.md` |
| `useServerState` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks`, `@zero/framework/sync/client` | [src/sync/client/state-hooks.ts:43](../../../../src/sync/client/state-hooks.ts) | `frontend/state/server-state.md` |
| `useServerStateReady` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks`, `@zero/framework/sync/client` | [src/sync/client/state-hooks.ts:86](../../../../src/sync/client/state-hooks.ts) | `frontend/state/server-state.md` |
| `useStickToBottom` | `@zero/framework`, `@zero/framework/react` | External re-export `use-stick-to-bottom`; [frontend barrel](../../../../src/frontend/index.ts) (external) | `frontend/components/scroll-anchoring.md` |
| `useStickToBottomContext` | `@zero/framework`, `@zero/framework/react` | External re-export `use-stick-to-bottom`; [frontend barrel](../../../../src/frontend/index.ts) (external) | `frontend/components/scroll-anchoring.md` |

## CodeBlock Working-Source Preference Hook

This is a 2.4.0-baseline feature-branch addition, not part of the original
pinned hook count or a qualified artifact. Persistence is opt-in UI state.
Subsequent focused package/compiled-reader checks are recorded in the
[2.5 qualification ledger](../docs-plugin-qualification.md), not inferred from
this source catalog or expanded to all historical hooks.

| Named symbol | Exact public imports | Declaration evidence | Canonical guide |
| --- | --- | --- | --- |
| `useCodeBlockPackageManager` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/code-block` | [Preference hook](../../../../src/components/code-block/code-block-package-preference.ts) | `frontend/components/public-pages/code-block-examples.md` |

## Reconciliation And Review

Every row has a planned home, but this catalog alone does not verify props, SSR safety, authority, cancellation, accessibility, or released behavior. Reconcile import routes against the [package export catalog](./package-exports.md). Cross-system contract owners remain Guardian, Resources/Sync/Fabric, Storage, Data Studio, Torrent, and Notifications/Rooms; frontend guides explain their UI/transport integration without duplicating backend policy. See the [system inventories](../systems/index.md) for dependencies, settings, tests present, examples, and unresolved findings. Independent reconciliation and exact-package checks remain open.
