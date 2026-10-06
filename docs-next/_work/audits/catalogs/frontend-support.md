---
id: zero.inventory.catalog.frontend-support
type: inventory
audience: [agent, maintainer]
owner: frontend-sdk
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

# Frontend Public Support APIs

[Catalog index](./index.md) · [Documentation index](../../../index.md)

## Baseline And Counting Rules

Static inspection of committed `main` source for framework 2.1.1, not an installed-artifact qualification. These records distinguish named exports from source-local helpers; no app module, environment file, database, Doctor, test suite, or provider was executed. Import alternatives are grouped in one row; aliases and same-name symbols backed by different modules retain separate rows. Package routes come from [package.json](../../../../package.json) and transitive local re-exports; third-party entries retain their external origin. Source links point to repo files; the label records the inspected declaration line, not a Markdown anchor. Planned guide paths are relative to `docs-next/` and deliberately plain text. All rows remain draft/source-observed; supported source/local surfaces still need exact-package qualification and mode-sensitive behavior review.

This catalog contains **94 frontend runtime/support export records**, excluding server-composition symbols owned by the backend inventory. These are helpers, transports, errors, registries, or public facades—not extra React components. Modal member methods are enumerated in the modal system inventory.

## Independent Catalog Reconciliation

Reviewed independently on 2026-10-05. The three public frontend runtime-symbol catalogs contain **639 records** (414 component, 131 hook, 94 support records). All **1,469 listed import alternatives** reconcile with the pinned package-export manifest: no missing route or named symbol was found. This is static manifest/source coverage, not installed-artifact execution or complete per-component browser verification. Canonical destinations for provider/scope/router/form/data-control features were reconciled with their owning inventories; aliases still preserve source identity. Approved dirty-working-tree defect corrections are recorded in those inventories rather than retroactively relabeling the original clean baseline as shipped support.

## Symbol Coverage

### Authorized Working-Source Signature Helpers

These additions accompany the unreleased signature UI on top of Zero 2.2.1;
they are not part of the original clean-baseline helper count.

| Named symbol | Exact import alternatives | Declaration evidence | Canonical guide |
| --- | --- | --- | --- |
| `getSignaturePadStrokePath` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/signature-pad` | [src/components/signature-pad/index.ts](../../../../src/components/signature-pad/index.ts) | [Signature Pad](../../../frontend/components/signature-pad.md#drawing-state-api-and-export-configuration) |
| `getSignaturePadBounds` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/signature-pad` | [src/components/signature-pad/index.ts](../../../../src/components/signature-pad/index.ts) | [Signature Pad](../../../frontend/components/signature-pad.md#drawing-state-api-and-export-configuration) |
| `signaturePadToSVG` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/signature-pad` | [src/components/signature-pad/index.ts](../../../../src/components/signature-pad/index.ts) | [Signature Pad](../../../frontend/components/signature-pad.md#drawing-state-api-and-export-configuration) |
| `signaturePadToDataURL` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/signature-pad` | [src/components/signature-pad/index.ts](../../../../src/components/signature-pad/index.ts) | [Signature Pad](../../../frontend/components/signature-pad.md#drawing-state-api-and-export-configuration) |
| `signaturePadToBlob` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/signature-pad` | [src/components/signature-pad/index.ts](../../../../src/components/signature-pad/index.ts) | [Signature Pad](../../../frontend/components/signature-pad.md#drawing-state-api-and-export-configuration) |
| `serializeSignaturePad` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/signature-pad` | [src/components/signature-pad/index.ts](../../../../src/components/signature-pad/index.ts) | [Signature Pad](../../../frontend/components/signature-pad.md#drawing-state-api-and-export-configuration) |
| `snapshotSignaturePadStrokes` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/signature-pad` | [src/components/signature-pad/index.ts](../../../../src/components/signature-pad/index.ts) | [Signature Pad](../../../frontend/components/signature-pad.md#drawing-state-api-and-export-configuration) |
| `hasSignaturePadInk` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/signature-pad` | [src/components/signature-pad/index.ts](../../../../src/components/signature-pad/index.ts) | [Signature Pad](../../../frontend/components/signature-pad.md#drawing-state-api-and-export-configuration) |

### Original Baseline

| Named symbol | Exact import alternatives | Declaration evidence | Canonical planned guide |
| --- | --- | --- | --- |
| `toast` | `@zero/framework`, `@zero/framework/react` | External re-export `sonner`; [frontend barrel](../../../../src/frontend/index.ts) (external) | `frontend/notifications/components.md` |
| `getVariants` | `@zero/framework/icons` | [src/components/animate-ui/icons/icon.tsx:610](../../../../src/components/animate-ui/icons/icon.tsx) | `frontend/design-system/icon-animation.md` |
| `pathClassName` | `@zero/framework/icons` | [src/components/animate-ui/icons/icon.tsx:441](../../../../src/components/animate-ui/icons/icon.tsx) | `frontend/design-system/icon-animation.md` |
| `staticAnimations` | `@zero/framework/icons` | [src/components/animate-ui/icons/icon.tsx:19](../../../../src/components/animate-ui/icons/icon.tsx) | `frontend/design-system/icon-animation.md` |
| `getZeroAnimatedIcon` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/icons` | [src/components/animate-ui/icons/registry.ts:160](../../../../src/components/animate-ui/icons/registry.ts) | `frontend/design-system/icon-registry.md` |
| `hasZeroAnimatedIcon` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/icons` | [src/components/animate-ui/icons/registry.ts:170](../../../../src/components/animate-ui/icons/registry.ts) | `frontend/design-system/icon-registry.md` |
| `resolveZeroAnimatedIcon` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/icons` | [src/components/animate-ui/icons/registry.ts:178](../../../../src/components/animate-ui/icons/registry.ts) | `frontend/design-system/icon-registry.md` |
| `zeroAnimatedIconNames` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/icons` | [src/components/animate-ui/icons/registry.ts:151](../../../../src/components/animate-ui/icons/registry.ts) | `frontend/design-system/icon-registry.md` |
| `zeroAnimatedIcons` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/icons` | [src/components/animate-ui/icons/registry.ts:81](../../../../src/components/animate-ui/icons/registry.ts) | `frontend/design-system/icon-registry.md` |
| `isAuthFlowContinuationResult` | `@zero/framework/components/auth` | [src/components/auth/auth-continuation.ts:80](../../../../src/components/auth/auth-continuation.ts) | [frontend/guardian/authentication-flows.md#public-result-guards](../../../frontend/guardian/authentication-flows.md#public-result-guards) |
| `isAuthSessionResult` | `@zero/framework/components/auth` | [src/components/auth/auth-continuation.ts:18](../../../../src/components/auth/auth-continuation.ts) | [frontend/guardian/authentication-flows.md#public-result-guards](../../../frontend/guardian/authentication-flows.md#public-result-guards) |
| `isMfaChallengeRequiredResult` | `@zero/framework/components/auth` | [src/components/auth/auth-continuation.ts:37](../../../../src/components/auth/auth-continuation.ts) | [frontend/guardian/authentication-flows.md#public-result-guards](../../../frontend/guardian/authentication-flows.md#public-result-guards) |
| `isMfaContinuationResult` | `@zero/framework/components/auth` | [src/components/auth/auth-continuation.ts:46](../../../../src/components/auth/auth-continuation.ts) | [frontend/guardian/authentication-flows.md#public-result-guards](../../../frontend/guardian/authentication-flows.md#public-result-guards) |
| `isMfaSetupRequiredResult` | `@zero/framework/components/auth` | [src/components/auth/auth-continuation.ts:28](../../../../src/components/auth/auth-continuation.ts) | [frontend/guardian/authentication-flows.md#public-result-guards](../../../frontend/guardian/authentication-flows.md#public-result-guards) |
| `isTenantOnboardingRequiredResult` | `@zero/framework/components/auth` | [src/components/auth/auth-continuation.ts:64](../../../../src/components/auth/auth-continuation.ts) | [frontend/guardian/authentication-flows.md#public-result-guards](../../../frontend/guardian/authentication-flows.md#public-result-guards) |
| `isTenantSelectionRequiredResult` | `@zero/framework/components/auth` | [src/components/auth/auth-continuation.ts:53](../../../../src/components/auth/auth-continuation.ts) | [frontend/guardian/authentication-flows.md#public-result-guards](../../../frontend/guardian/authentication-flows.md#public-result-guards) |
| `getAuthDisplayMessage` | `@zero/framework/components/auth` | [src/components/auth/auth-error.ts:23](../../../../src/components/auth/auth-error.ts) | [frontend/guardian/account-actions.md#auth-error-helpers](../../../frontend/guardian/account-actions.md#auth-error-helpers) |
| `getAuthErrorCode` | `@zero/framework/components/auth` | [src/components/auth/auth-error.ts:13](../../../../src/components/auth/auth-error.ts) | [frontend/guardian/account-actions.md#auth-error-helpers](../../../frontend/guardian/account-actions.md#auth-error-helpers) |
| `reportAuthUiError` | `@zero/framework/components/auth` | [src/components/auth/auth-error.ts:63](../../../../src/components/auth/auth-error.ts) | [frontend/guardian/account-actions.md#auth-error-helpers](../../../frontend/guardian/account-actions.md#auth-error-helpers) |
| `calcPasswordStrength` | `@zero/framework/components/auth` | [src/components/auth/password-strength.tsx:30](../../../../src/components/auth/password-strength.tsx) | [frontend/guardian/auth-primitives.md#passwordinput-passwordstrength-and-helpers](../../../frontend/guardian/auth-primitives.md#passwordinput-passwordstrength-and-helpers) |
| `getPasswordRules` | `@zero/framework/components/auth` | [src/components/auth/password-strength.tsx:20](../../../../src/components/auth/password-strength.tsx) | [frontend/guardian/auth-primitives.md#passwordinput-passwordstrength-and-helpers](../../../frontend/guardian/auth-primitives.md#passwordinput-passwordstrength-and-helpers) |
| `resolveDataStudioCellKeyAction` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/data-studio` | [src/components/data-studio/data-studio-inline-cell.tsx:361](../../../../src/components/data-studio/data-studio-inline-cell.tsx) | `frontend/data-studio/inline-cell.md` |
| `dataStudioCodeExample` | `@zero/framework/components/data-studio` | [src/components/data-studio/data-studio-value.ts:84](../../../../src/components/data-studio/data-studio-value.ts) | `frontend/data-studio/values.md` |
| `dataStudioValueDraft` | `@zero/framework/components/data-studio` | [src/components/data-studio/data-studio-value.ts:23](../../../../src/components/data-studio/data-studio-value.ts) | `frontend/data-studio/values.md` |
| `formatDataStudioValue` | `@zero/framework/components/data-studio` | [src/components/data-studio/data-studio-value.ts:9](../../../../src/components/data-studio/data-studio-value.ts) | `frontend/data-studio/values.md` |
| `parseDataStudioValueDraft` | `@zero/framework/components/data-studio` | [src/components/data-studio/data-studio-value.ts:43](../../../../src/components/data-studio/data-studio-value.ts) | `frontend/data-studio/values.md` |
| `buildDataTableServerQuery` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/data-table` | [src/components/data-table/data-table-server-query.ts:109](../../../../src/components/data-table/data-table-server-query.ts) | `frontend/data-controls/data-table/server-sources.md` |
| `createDataTableApiAdapter` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/data-table` | [src/components/data-table/data-table-server-query.ts:151](../../../../src/components/data-table/data-table-server-query.ts) | `frontend/data-controls/data-table/server-sources.md` |
| `DataTableServerSourceError` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/data-table` | [src/components/data-table/data-table-server-types.ts:88](../../../../src/components/data-table/data-table-server-types.ts) | `frontend/data-controls/data-table/server-sources.md` |
| `buildDataTableLazyQuery` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/data-table` | [src/components/data-table/data-table-source.ts:102](../../../../src/components/data-table/data-table-source.ts) | `frontend/data-controls/data-table/sources.md` |
| `groupKanbanItemIds` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/kanban` | [src/components/kanban/kanban-utils.ts:33](../../../../src/components/kanban/kanban-utils.ts) | `frontend/data-controls/kanban.md` |
| `projectKanbanMove` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/kanban` | [src/components/kanban/kanban-utils.ts:51](../../../../src/components/kanban/kanban-utils.ts) | `frontend/data-controls/kanban.md` |
| `storageDriveEditableFields` | `@zero/framework/components/storage` | [src/components/storage/storage-drive-schema.ts:29](../../../../src/components/storage/storage-drive-schema.ts) | `frontend/storage/storage-drive-list.md` |
| `storageDriveListColumns` | `@zero/framework/components/storage` | [src/components/storage/storage-drive-schema.ts:26](../../../../src/components/storage/storage-drive-schema.ts) | `frontend/storage/storage-drive-list.md` |
| `storageDriveSchema` | `@zero/framework/components/storage` | [src/components/storage/storage-drive-schema.ts:11](../../../../src/components/storage/storage-drive-schema.ts) | `frontend/storage/storage-drive-list.md` |
| `badgeVariants` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/ui/badge` | [src/components/ui/badge.tsx:6](../../../../src/components/ui/badge.tsx) | `frontend/components/primitives/surfaces.md` |
| `buttonVariants` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/ui/button` | [src/components/ui/button.tsx:17](../../../../src/components/ui/button.tsx) | `frontend/components/primitives/inputs.md` |
| `resolveInlineEditTextKeyAction` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/ui/inline-edit-text` | [src/components/ui/inline-edit-text.tsx:303](../../../../src/components/ui/inline-edit-text.tsx) | `frontend/components/primitives/inline-editing.md` |
| `formatRelativeTime` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/ui/notification-item` | [src/components/ui/notification-item.tsx:87](../../../../src/components/ui/notification-item.tsx) | `frontend/notifications/components.md` |
| `ApiError` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/api.ts:39](../../../../src/frontend/client/api.ts) | `frontend/sdk/typed-api.md` |
| `unwrap` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/api.ts:86](../../../../src/frontend/client/api.ts) | `frontend/sdk/typed-api.md` |
| `hasAnyAuthorizationPermission` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/auth-authorization-types.ts:69](../../../../src/frontend/client/auth-authorization-types.ts) | [frontend/guardian/sdk-surfaces.md#state-and-authorization](../../../frontend/guardian/sdk-surfaces.md#state-and-authorization) |
| `hasAuthorizationPermission` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/auth-authorization-types.ts:49](../../../../src/frontend/client/auth-authorization-types.ts) | [frontend/guardian/sdk-surfaces.md#state-and-authorization](../../../frontend/guardian/sdk-surfaces.md#state-and-authorization) |
| `hasEveryAuthorizationPermission` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/auth-authorization-types.ts:61](../../../../src/frontend/client/auth-authorization-types.ts) | [frontend/guardian/sdk-surfaces.md#state-and-authorization](../../../frontend/guardian/sdk-surfaces.md#state-and-authorization) |
| `AuthClient` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/auth-client.ts:314](../../../../src/frontend/client/auth-client.ts) | [frontend/guardian/auth-client.md](../../../frontend/guardian/auth-client.md) |
| `AuthClientError` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/auth-errors.ts:7](../../../../src/frontend/client/auth-errors.ts) | [frontend/guardian/auth-client.md](../../../frontend/guardian/auth-client.md) |
| `AuthSessionSynchronizationError` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/auth-session.ts:40](../../../../src/frontend/client/auth-session.ts) | [frontend/guardian/auth-client.md](../../../frontend/guardian/auth-client.md) |
| `isAuthEmailVerificationRequiredResult` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/auth-types.ts:639](../../../../src/frontend/client/auth-types.ts) | [frontend/guardian/sdk-surfaces.md#account-entry-and-completion](../../../frontend/guardian/sdk-surfaces.md#account-entry-and-completion) |
| `isAuthTenantOnboardingRequiredResult` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/auth-types.ts:629](../../../../src/frontend/client/auth-types.ts) | [frontend/guardian/sdk-surfaces.md#account-entry-and-completion](../../../frontend/guardian/sdk-surfaces.md#account-entry-and-completion) |
| `isAuthTenantSelectionRequiredResult` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/auth-types.ts:617](../../../../src/frontend/client/auth-types.ts) | [frontend/guardian/sdk-surfaces.md#account-entry-and-completion](../../../frontend/guardian/sdk-surfaces.md#account-entry-and-completion) |
| `isAuthorizationScopeCallbackCurrent` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/authorization-scope-hooks.ts:87](../../../../src/frontend/client/authorization-scope-hooks.ts) | `frontend/runtime/authorization-scope-boundary.md` |
| `shouldUseSsrFallback` | `@zero/framework/react/hooks` | [src/frontend/client/client-context.tsx:27](../../../../src/frontend/client/client-context.tsx) | `frontend/runtime/client-provider.md` |
| `matchClientRoute` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/client-router.ts:64](../../../../src/frontend/client/client-router.ts) | `frontend/router/navigation.md` |
| `navigateTo` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/client-router.ts:131](../../../../src/frontend/client/client-router.ts) | `frontend/router/navigation.md` |
| `prefetchRoute` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/client-router.ts:119](../../../../src/frontend/client/client-router.ts) | `frontend/router/navigation.md` |
| `registerRoute` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/client-router.ts:47](../../../../src/frontend/client/client-router.ts) | `frontend/router/navigation.md` |
| `resolveDataStudioAccess` | `@zero/framework/react/hooks` | [src/frontend/client/data-studio-controller-types.ts:97](../../../../src/frontend/client/data-studio-controller-types.ts) | `frontend/data-studio/configuration.md` |
| `createDataStudioOperationId` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/data-studio-mutation.ts:48](../../../../src/frontend/client/data-studio-mutation.ts) | `frontend/data-studio/sdk.md` |
| `DataStudioMutationError` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/data-studio-mutation.ts:19](../../../../src/frontend/client/data-studio-mutation.ts) | `frontend/data-studio/sdk.md` |
| `isDataStudioMutationError` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/data-studio-mutation.ts:61](../../../../src/frontend/client/data-studio-mutation.ts) | `frontend/data-studio/sdk.md` |
| `isDataStudioRevisionConflict` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/data-studio-mutation.ts:65](../../../../src/frontend/client/data-studio-mutation.ts) | `frontend/data-studio/sdk.md` |
| `DataStudioOperationTracker` | `@zero/framework/react/hooks` | [src/frontend/client/data-studio-operation-tracker.ts:17](../../../../src/frontend/client/data-studio-operation-tracker.ts) | `frontend/data-studio/sdk.md` |
| `dataStudioCellValue` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/data-studio-query.ts:106](../../../../src/frontend/client/data-studio-query.ts) | `frontend/data-studio/values.md` |
| `dataStudioRowQueryKey` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/data-studio-query.ts:29](../../../../src/frontend/client/data-studio-query.ts) | `frontend/data-studio/values.md` |
| `dataStudioRowValuesByKey` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/data-studio-query.ts:92](../../../../src/frontend/client/data-studio-query.ts) | `frontend/data-studio/values.md` |
| `createDataStudioSdkSurface` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/data-studio-surface.ts:47](../../../../src/frontend/client/data-studio-surface.ts) | `frontend/data-studio/sdk.md` |
| `DATA_STUDIO_API_PREFIX` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/data-studio-surface.ts:42](../../../../src/frontend/client/data-studio-surface.ts) | `frontend/data-studio/sdk.md` |
| `startHydration` | `@zero/framework/react/hydrate-runtime` | [src/frontend/client/hydrate-runtime.tsx:105](../../../../src/frontend/client/hydrate-runtime.tsx) | `frontend/runtime/hydration.md` |
| `CompositeFrontendSink` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/observability.ts:135](../../../../src/frontend/client/observability.ts) | `frontend/observability.md` |
| `configureFrontendObservability` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/observability.ts:51](../../../../src/frontend/client/observability.ts) | `frontend/observability.md` |
| `ConsoleFrontendSink` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/observability.ts:93](../../../../src/frontend/client/observability.ts) | `frontend/observability.md` |
| `emitFrontendCode` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/observability.ts:75](../../../../src/frontend/client/observability.ts) | `frontend/observability.md` |
| `emitFrontendEvent` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/observability.ts:63](../../../../src/frontend/client/observability.ts) | `frontend/observability.md` |
| `getFrontendObservabilitySink` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/observability.ts:57](../../../../src/frontend/client/observability.ts) | `frontend/observability.md` |
| `HttpFrontendSink` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/observability.ts:118](../../../../src/frontend/client/observability.ts) | `frontend/observability.md` |
| `buildDataPageQuery` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/query-params.ts:114](../../../../src/frontend/client/query-params.ts) | `frontend/sdk/data-composition.md` |
| `buildResourceListQuery` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/react/hooks` | [src/frontend/client/query-params.ts:138](../../../../src/frontend/client/query-params.ts) | `frontend/sdk/data-composition.md` |
| `ResourceMutationError` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/resource-client.ts:62](../../../../src/frontend/client/resource-client.ts) | `frontend/sdk/resources.md` |
| `createClient` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/sdk.ts:837](../../../../src/frontend/client/sdk.ts) | `frontend/sdk/client-lifecycle.md` |
| `FetchError` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/sdk.ts:329](../../../../src/frontend/client/sdk.ts) | `frontend/sdk/client-lifecycle.md` |
| `getClient` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/sdk.ts:1571](../../../../src/frontend/client/sdk.ts) | `frontend/sdk/client-lifecycle.md` |
| `createStorageStudioOperationId` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/storage-studio-mutation.ts:54](../../../../src/frontend/client/storage-studio-mutation.ts) | `frontend/storage/sdk-integration.md` |
| `isStorageStudioMutationError` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/storage-studio-mutation.ts:67](../../../../src/frontend/client/storage-studio-mutation.ts) | `frontend/storage/sdk-integration.md` |
| `StorageStudioMutationError` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/storage-studio-mutation.ts:22](../../../../src/frontend/client/storage-studio-mutation.ts) | `frontend/storage/sdk-integration.md` |
| `createStorageStudioSdkSurface` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/storage-studio-surface.ts:40](../../../../src/frontend/client/storage-studio-surface.ts) | `frontend/storage/sdk-integration.md` |
| `STORAGE_STUDIO_API_PREFIX` | `@zero/framework`, `@zero/framework/react` | [src/frontend/client/storage-studio-surface.ts:35](../../../../src/frontend/client/storage-studio-surface.ts) | `frontend/storage/sdk-integration.md` |
| `isPublicPath` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/server` | [src/frontend/router/auth-policy.ts:27](../../../../src/frontend/router/auth-policy.ts) | `frontend/router/authentication.md` |
| `mergeRouteAuthRequirements` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/server` | [src/frontend/router/auth-policy.ts:68](../../../../src/frontend/router/auth-policy.ts) | `frontend/router/authentication.md` |
| `normalizeRouteAuthRequirement` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/server` | [src/frontend/router/auth-policy.ts:55](../../../../src/frontend/router/auth-policy.ts) | `frontend/router/authentication.md` |
| `resolveRouteAuthMode` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/server` | [src/frontend/router/auth-policy.ts:46](../../../../src/frontend/router/auth-policy.ts) | `frontend/router/authentication.md` |
| `shouldRequireAuthForRoute` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/server` | [src/frontend/router/auth-policy.ts:102](../../../../src/frontend/router/auth-policy.ts) | `frontend/router/authentication.md` |
| `getOS` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/hooks` | [src/hooks/use-os.ts:53](../../../../src/hooks/use-os.ts) | `frontend/hooks/browser-interactions.md` |
| `modals` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/modals` | [src/modals/modal-events.ts:129](../../../../src/modals/modal-events.ts) | `frontend/modals/content.md` |
| `MODAL_SIZE_CLASSES` | `@zero/framework/modals` | [src/modals/modal.types.ts:9](../../../../src/modals/modal.types.ts) | `frontend/modals/configuration.md` |

## Zero 2.4 Additions

This supplement does not alter the original pinned inventory count. Grouped
action/selection controls use one public class composer; it supplies no state,
authority or asynchronous-action behavior.

| Symbol | Public imports | Evidence | Canonical guide |
| --- | --- | --- | --- |
| `buttonGroupVariants` | `@zero/framework`, `@zero/framework/react`, `@zero/framework/components/button-group` | [Group styles](../../../../src/components/button-group/button-group-styles.ts) | `frontend/components/primitives/button-group.md` |

## Complete CodeBlock Working-Source Helpers

These supplement the original pinned helper counts; source is dirty on the
2.4.0 baseline, not an installed-package qualification. The pure server/highlight/
metadata paths avoid React rendering. Corresponding types have the same homes.
Subsequent focused installed/compiled checks are recorded separately in the
[2.5 qualification ledger](../docs-plugin-qualification.md); they do not qualify
every helper in the original pinned counts.

| Named symbol | Exact public imports | Declaration evidence | Canonical guide |
| --- | --- | --- | --- |
| `prepareCodeBlock` | `@zero/framework/components/code-block/server`; root/React/family | [Server preparation](../../../../src/components/code-block/code-block-server.ts) | `frontend/components/public-pages/code-block-rendering.md` |
| `highlightCodeBlock` | `@zero/framework/components/code-block/highlight`; root/React/family | [Shared renderer](../../../../src/components/code-block/code-block-highlight.ts) | `frontend/components/public-pages/code-block-rendering.md` |
| `highlightCodeBlockHtml` | `@zero/framework/components/code-block/highlight`; root/React/family | [Shared renderer](../../../../src/components/code-block/code-block-highlight.ts) | `frontend/components/public-pages/code-block-rendering.md` |
| `buildFallbackCodeBlockHtml` | `@zero/framework/components/code-block/highlight`; root/React/family | [Escaped fallback](../../../../src/components/code-block/code-block-highlight.ts) | `frontend/components/public-pages/code-block-rendering.md` |
| `normalizeCodeBlockLineHtml` | `@zero/framework/components/code-block/highlight` | [Line normalization](../../../../src/components/code-block/code-block-highlight.ts) | `frontend/components/public-pages/code-block-rendering.md` |
| `readCodeBlockMetadata` | `@zero/framework/components/code-block/metadata`; root/React/family | [Bounded metadata](../../../../src/components/code-block/code-block-metadata.ts) | `frontend/components/public-pages/code-block-rendering.md` |
| `parseCodeBlockLineRanges` | `@zero/framework/components/code-block/metadata`; root/React/family | [Bounded ranges](../../../../src/components/code-block/code-block-metadata.ts) | `frontend/components/public-pages/code-block-rendering.md` |
| `codeBlockHighlightKey` | `@zero/framework/components/code-block/metadata` | [Non-security fingerprint](../../../../src/components/code-block/code-block-metadata.ts) | `frontend/components/public-pages/code-block-rendering.md` |
| `normalizeStartLine` | `@zero/framework/components/code-block/metadata` | [Number normalization](../../../../src/components/code-block/code-block-metadata.ts) | `frontend/components/public-pages/code-block-rendering.md` |
| `getCodeBlockPackageCommand` | root/React/`@zero/framework/components/code-block` | [Displayed command helper](../../../../src/components/code-block/code-block-package-manager.tsx) | `frontend/components/public-pages/code-block-examples.md` |
| `CODE_BLOCK_PACKAGE_MANAGERS` | root/React/`@zero/framework/components/code-block` | [Supported managers](../../../../src/components/code-block/code-block-package-preference.ts) | `frontend/components/public-pages/code-block-examples.md` |

## Reconciliation And Review

Every row has a planned home, but this catalog alone does not verify props, SSR safety, authority, cancellation, accessibility, or released behavior. Reconcile import routes against the [package export catalog](./package-exports.md). Cross-system contract owners remain Guardian, Resources/Sync/Fabric, Storage, Data Studio, Torrent, and Notifications/Rooms; frontend guides explain their UI/transport integration without duplicating backend policy. See the [system inventories](../systems/index.md) for dependencies, settings, tests present, examples, and unresolved findings. Independent reconciliation and exact-package checks remain open.
