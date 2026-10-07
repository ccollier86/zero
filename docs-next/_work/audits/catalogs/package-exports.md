---
id: zero.audit.catalog.package-exports
type: inventory
audience: [maintainer, agent]
owner: zero-documentation
status: in-review
visibility: internal
---

# Package Export Reconciliation

[Catalog index](./index.md) · [Documentation index](../../../index.md)

Static inspection of `package.json` and TypeScript export declarations at
`a3a5f726768dac890f241a3899c0a1acb66265d9`, framework **2.1.1**, 2026-10-04.
No module, application config, provider, database, or CLI workflow was executed.
The checked-in [symbol manifest](./package-exports.json) records every extracted
path/name pair for coverage reconciliation; it is internal working data.

## Counts And Interpretation

- 66 declared package export keys; expanding `components/ui/*` produces
  108 concrete source targets including three test-file targets.
- 6425 path/symbol occurrences. Root/React aliases and subpath re-exports
  repeat names; this is **not** a count of unique features or independent APIs.
- Static export extraction does not establish browser safety, runtime behavior,
  type inference, or exact-archive support. Those require separate checks.
- Type-only declarations, value exports, helper contracts, and public-but-low-level
  utilities must be classified by their owning inventories and feature guides.

## Entrypoint Ownership

A row assigns the entrypoint's composition responsibility. Mixed barrels (notably
`/react` and `/server`) additionally expose features owned by other systems;
their named symbols must be reconciled with those systems, not documented as
independent duplicate contracts.

| Import suffix | Source target | Named exports | Inventory owner |
| --- | --- | ---: | --- |
| `./package.json` | [package.json](../../../../package.json) | 0 | [cli-tooling](../systems/cli-tooling.md) |
| `.` | [src/frontend/index.ts](../../../../src/frontend/index.ts) | 1161 | [frontend-runtime](../systems/frontend-runtime.md) |
| `./react` | [src/frontend/index.ts](../../../../src/frontend/index.ts) | 1161 | [frontend-runtime](../systems/frontend-runtime.md) |
| `./react/app-provider` | [src/frontend/client/app-provider.tsx](../../../../src/frontend/client/app-provider.tsx) | 2 | [frontend-runtime](../systems/frontend-runtime.md) |
| `./react/hydrate-runtime` | [src/frontend/client/hydrate-runtime.tsx](../../../../src/frontend/client/hydrate-runtime.tsx) | 3 | [frontend-runtime](../systems/frontend-runtime.md) |
| `./react/hooks` | [src/frontend/client/hooks.ts](../../../../src/frontend/client/hooks.ts) | 183 | [frontend-runtime](../systems/frontend-runtime.md) |
| `./server` | [src/frontend/server.ts](../../../../src/frontend/server.ts) | 1042 | [platform-runtime](../systems/platform-runtime.md) |
| `./schema` | [src/schema/index.ts](../../../../src/schema/index.ts) | 37 | [schema](../systems/schema.md) |
| `./icons` | [src/frontend/icons.ts](../../../../src/frontend/icons.ts) | 279 | [design-system](../systems/design-system.md) |
| `./ai` | [src/ai/index.ts](../../../../src/ai/index.ts) | 197 | [ai](../systems/ai.md) |
| `./auth` | [src/auth/index.ts](../../../../src/auth/index.ts) | 422 | [guardian](../systems/guardian.md) |
| `./native` | [src/native/index.ts](../../../../src/native/index.ts) | 37 | [native-auth-sdks](../systems/native-auth-sdks.md) |
| `./doctor` | [src/doctor/index.ts](../../../../src/doctor/index.ts) | 16 | [cli-tooling](../systems/cli-tooling.md) |
| `./data-studio` | [src/data-studio/index.ts](../../../../src/data-studio/index.ts) | 78 | [data-studio](../systems/data-studio.md) |
| `./data-studio/server` | [src/data-studio/server.ts](../../../../src/data-studio/server.ts) | 101 | [data-studio](../systems/data-studio.md) |
| `./database-automations` | [src/database-automations/index.ts](../../../../src/database-automations/index.ts) | 56 | [database-automations](../systems/database-automations.md) |
| `./email` | [src/email/index.ts](../../../../src/email/index.ts) | 22 | [email](../systems/email.md) |
| `./hooks` | [src/hooks/index.ts](../../../../src/hooks/index.ts) | 54 | [frontend-forms](../systems/frontend-forms.md) |
| `./kv` | [src/kv/index.ts](../../../../src/kv/index.ts) | 57 | [kv](../systems/kv.md) |
| `./migrations` | [src/migrations/index.ts](../../../../src/migrations/index.ts) | 26 | [migrations](../systems/migrations.md) |
| `./modals` | [src/modals/index.ts](../../../../src/modals/index.ts) | 16 | [modal-manager](../systems/modal-manager.md) |
| `./notifications` | [src/notifications/index.ts](../../../../src/notifications/index.ts) | 14 | [notifications](../systems/notifications.md) |
| `./observability` | [src/observability/index.ts](../../../../src/observability/index.ts) | 36 | [observability](../systems/observability.md) |
| `./observability/codes` | [src/observability/codes.ts](../../../../src/observability/codes.ts) | 2 | [observability](../systems/observability.md) |
| `./pdf` | [src/pdf/index.ts](../../../../src/pdf/index.ts) | 46 | [pdf](../systems/pdf.md) |
| `./persistence` | [src/persistence/index.ts](../../../../src/persistence/index.ts) | 30 | [persistence](../systems/persistence.md) |
| `./rooms` | [src/rooms/index.ts](../../../../src/rooms/index.ts) | 15 | [rooms](../systems/rooms.md) |
| `./resources` | [src/resources/index.ts](../../../../src/resources/index.ts) | 133 | [resources](../systems/resources.md) |
| `./scheduler` | [src/scheduler/index.ts](../../../../src/scheduler/index.ts) | 6 | [scheduler](../systems/scheduler.md) |
| `./storage` | [src/storage/index.ts](../../../../src/storage/index.ts) | 122 | [storage](../systems/storage.md) |
| `./tokens` | [src/tokens/index.ts](../../../../src/tokens/index.ts) | 25 | [tokens](../systems/tokens.md) |
| `./sync` | [src/sync/index.ts](../../../../src/sync/index.ts) | 134 | [sync](../systems/sync.md) |
| `./sync/client` | [src/sync/client/index.ts](../../../../src/sync/client/index.ts) | 48 | [sync](../systems/sync.md) |
| `./sync/identity` | [src/sync/identity.ts](../../../../src/sync/identity.ts) | 9 | [sync](../systems/sync.md) |
| `./sync/types` | [src/sync/types.ts](../../../../src/sync/types.ts) | 74 | [sync](../systems/sync.md) |
| `./vector` | [src/vector/index.ts](../../../../src/vector/index.ts) | 45 | [vector](../systems/vector.md) |
| `./workflows` | [src/workflows/index.ts](../../../../src/workflows/index.ts) | 169 | [torrent](../systems/torrent.md) |
| `./components/auth` | [src/components/auth/index.ts](../../../../src/components/auth/index.ts) | 117 | [guardian](../systems/guardian.md) |
| `./components/app-shell` | [src/components/app-shell/index.ts](../../../../src/components/app-shell/index.ts) | 20 | [frontend-runtime](../systems/frontend-runtime.md) |
| `./components/animated-list` | [src/components/animated-list/index.ts](../../../../src/components/animated-list/index.ts) | 6 | [frontend-components](../systems/frontend-components.md) |
| `./components/bento-grid` | [src/components/bento-grid/index.ts](../../../../src/components/bento-grid/index.ts) | 7 | [frontend-components](../systems/frontend-components.md) |
| `./components/code-block` | [src/components/code-block/index.ts](../../../../src/components/code-block/index.ts) | 4 | [frontend-components](../systems/frontend-components.md) |
| `./components/cta` | [src/components/cta/index.ts](../../../../src/components/cta/index.ts) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/collapsible` | [src/components/collapsible/index.ts](../../../../src/components/collapsible/index.ts) | 8 | [frontend-components](../systems/frontend-components.md) |
| `./components/data-table` | [src/components/data-table/index.ts](../../../../src/components/data-table/index.ts) | 57 | [frontend-data-controls](../systems/frontend-data-controls.md) |
| `./components/data-studio` | [src/components/data-studio/index.ts](../../../../src/components/data-studio/index.ts) | 28 | [frontend-data-controls](../systems/frontend-data-controls.md) |
| `./components/dropdown-menu` | [src/components/dropdown-menu/index.ts](../../../../src/components/dropdown-menu/index.ts) | 28 | [frontend-components](../systems/frontend-components.md) |
| `./components/popover` | [src/components/popover/index.ts](../../../../src/components/popover/index.ts) | 8 | [frontend-components](../systems/frontend-components.md) |
| `./components/expandable-card` | [src/components/expandable-card/index.ts](../../../../src/components/expandable-card/index.ts) | 3 | [frontend-components](../systems/frontend-components.md) |
| `./components/faq` | [src/components/faq/index.ts](../../../../src/components/faq/index.ts) | 3 | [frontend-components](../systems/frontend-components.md) |
| `./components/features` | [src/components/features/index.ts](../../../../src/components/features/index.ts) | 3 | [frontend-components](../systems/frontend-components.md) |
| `./components/footer` | [src/components/footer/index.ts](../../../../src/components/footer/index.ts) | 4 | [frontend-components](../systems/frontend-components.md) |
| `./components/hero` | [src/components/hero/index.ts](../../../../src/components/hero/index.ts) | 11 | [frontend-components](../systems/frontend-components.md) |
| `./components/kanban` | [src/components/kanban/index.ts](../../../../src/components/kanban/index.ts) | 10 | [frontend-components](../systems/frontend-components.md) |
| `./components/qr-code` | [src/components/qr-code/index.ts](../../../../src/components/qr-code/index.ts) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/radial-menu` | [src/components/radial-menu/index.ts](../../../../src/components/radial-menu/index.ts) | 3 | [frontend-components](../systems/frontend-components.md) |
| `./components/secret-field` | [src/components/secret-field/index.ts](../../../../src/components/secret-field/index.ts) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/sidebar` | [src/components/sidebar/index.ts](../../../../src/components/sidebar/index.ts) | 24 | [frontend-components](../systems/frontend-components.md) |
| `./components/master-detail` | [src/components/master-detail/index.ts](../../../../src/components/master-detail/index.ts) | 4 | [frontend-data-controls](../systems/frontend-data-controls.md) |
| `./components/navbar` | [src/components/navbar/index.ts](../../../../src/components/navbar/index.ts) | 5 | [frontend-components](../systems/frontend-components.md) |
| `./components/text-effects` | [src/components/text-effects/index.ts](../../../../src/components/text-effects/index.ts) | 7 | [frontend-components](../systems/frontend-components.md) |
| `./components/streaming-text` | [src/components/streaming-text/index.ts](../../../../src/components/streaming-text/index.ts) | 4 | [frontend-components](../systems/frontend-components.md) |
| `./components/tooltip` | [src/components/tooltip/index.ts](../../../../src/components/tooltip/index.ts) | 6 | [frontend-components](../systems/frontend-components.md) |
| `./components/storage` | [src/components/storage/index.ts](../../../../src/components/storage/index.ts) | 55 | [frontend-data-controls](../systems/frontend-data-controls.md) |
| `./components/ui/theme-provider` | [src/components/ui/theme-provider.tsx](../../../../src/components/ui/theme-provider.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/date-range-picker` | [src/components/ui/date-range-picker.tsx](../../../../src/components/ui/date-range-picker.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/time-picker` | [src/components/ui/time-picker.tsx](../../../../src/components/ui/time-picker.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/pagination` | [src/components/ui/pagination.tsx](../../../../src/components/ui/pagination.tsx) | 7 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/form-field` | [src/components/ui/form-field.tsx](../../../../src/components/ui/form-field.tsx) | 6 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/card` | [src/components/ui/card.tsx](../../../../src/components/ui/card.tsx) | 6 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/inline-edit-text` | [src/components/ui/inline-edit-text.tsx](../../../../src/components/ui/inline-edit-text.tsx) | 5 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/progress` | [src/components/ui/progress.tsx](../../../../src/components/ui/progress.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/date-picker` | [src/components/ui/date-picker.tsx](../../../../src/components/ui/date-picker.tsx) | 3 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/chart` | [src/components/ui/chart.tsx](../../../../src/components/ui/chart.tsx) | 8 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/notification-list` | [src/components/ui/notification-list.tsx](../../../../src/components/ui/notification-list.tsx) | 3 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/detail-panel` | [src/components/ui/detail-panel.tsx](../../../../src/components/ui/detail-panel.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/notification-dropdown` | [src/components/ui/notification-dropdown.tsx](../../../../src/components/ui/notification-dropdown.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/card.test` | [src/components/ui/card.test.tsx](../../../../src/components/ui/card.test.tsx) | 0 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/scroll-area` | [src/components/ui/scroll-area.tsx](../../../../src/components/ui/scroll-area.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/label` | [src/components/ui/label.tsx](../../../../src/components/ui/label.tsx) | 1 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/sonner` | [src/components/ui/sonner.tsx](../../../../src/components/ui/sonner.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/combobox` | [src/components/ui/combobox.tsx](../../../../src/components/ui/combobox.tsx) | 3 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/calendar` | [src/components/ui/calendar.tsx](../../../../src/components/ui/calendar.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/notification-item` | [src/components/ui/notification-item.tsx](../../../../src/components/ui/notification-item.tsx) | 4 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/breadcrumb` | [src/components/ui/breadcrumb.tsx](../../../../src/components/ui/breadcrumb.tsx) | 7 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/record-navigation-bar.test` | [src/components/ui/record-navigation-bar.test.tsx](../../../../src/components/ui/record-navigation-bar.test.tsx) | 0 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/radio-group` | [src/components/ui/radio-group.tsx](../../../../src/components/ui/radio-group.tsx) | 4 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/command` | [src/components/ui/command.tsx](../../../../src/components/ui/command.tsx) | 9 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/avatar` | [src/components/ui/avatar.tsx](../../../../src/components/ui/avatar.tsx) | 3 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/record-navigation-bar` | [src/components/ui/record-navigation-bar.tsx](../../../../src/components/ui/record-navigation-bar.tsx) | 4 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/tag-input` | [src/components/ui/tag-input.tsx](../../../../src/components/ui/tag-input.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/notification-badge` | [src/components/ui/notification-badge.tsx](../../../../src/components/ui/notification-badge.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/validation-rules` | [src/components/ui/validation-rules.tsx](../../../../src/components/ui/validation-rules.tsx) | 3 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/badge` | [src/components/ui/badge.tsx](../../../../src/components/ui/badge.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/table` | [src/components/ui/table.tsx](../../../../src/components/ui/table.tsx) | 8 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/separator` | [src/components/ui/separator.tsx](../../../../src/components/ui/separator.tsx) | 1 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/list-detail-layout.test` | [src/components/ui/list-detail-layout.test.tsx](../../../../src/components/ui/list-detail-layout.test.tsx) | 0 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/notification-center` | [src/components/ui/notification-center.tsx](../../../../src/components/ui/notification-center.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/validation-meter` | [src/components/ui/validation-meter.tsx](../../../../src/components/ui/validation-meter.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/button` | [src/components/ui/button.tsx](../../../../src/components/ui/button.tsx) | 3 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/checkbox` | [src/components/ui/checkbox.tsx](../../../../src/components/ui/checkbox.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/select` | [src/components/ui/select.tsx](../../../../src/components/ui/select.tsx) | 10 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/textarea` | [src/components/ui/textarea.tsx](../../../../src/components/ui/textarea.tsx) | 1 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/input` | [src/components/ui/input.tsx](../../../../src/components/ui/input.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/list-detail-layout` | [src/components/ui/list-detail-layout.tsx](../../../../src/components/ui/list-detail-layout.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/stat-card` | [src/components/ui/stat-card.tsx](../../../../src/components/ui/stat-card.tsx) | 2 | [frontend-components](../systems/frontend-components.md) |
| `./components/ui/skeleton` | [src/components/ui/skeleton.tsx](../../../../src/components/ui/skeleton.tsx) | 1 | [frontend-components](../systems/frontend-components.md) |
| `./styles.css` | [src/frontend/styles/globals.css](../../../../src/frontend/styles/globals.css) | 0 | [design-system](../systems/design-system.md) |

## Packaging Finding: Test Files Match The UI Wildcard

The wildcard target `./src/components/ui/*.tsx` also resolves
`card.test.tsx`, `record-navigation-bar.test.tsx`, and
`list-detail-layout.test.tsx`. The manifest's `files` includes `src`.
These are test modules, not intended reader-facing component APIs. The manifest
marks them `unintended-test-wildcard`; do not fabricate feature documentation
for them. The user subsequently authorized all confirmed defect corrections.
The working manifest now explicitly null-excludes `./components/ui/*.test`
and `*.spec`; [public UI resolution tests](../../../../src/package-ui-exports.test.ts)
pass 2/2, preserving intended imports and rejecting tests without executing them.
The counts/table/JSON above retain the original committed baseline, not a claim
that test routes remain available in the corrected tree. Archive qualification
is still pending.

## Approved Working-Source Supplements

The table/JSON above retain the original committed baseline; these new narrow
surfaces belong to unreleased source corrections and must be re-extracted from
the exact frozen candidate before artifact qualification:

| Surface | Owning guide / meaning |
| --- | --- |
| RoomInputError from @zero/framework/rooms | [Rooms](../../../backend/rooms/service.md): stable capacity invariant rejection, no auth bypass. |
| SchemaConfigurationError from @zero/framework/schema | [Schema defaults](../../../backend/schema/fields.md#default-admission-and-errors): safe field-type-only SCHEMA_DEFAULT_INVALID declaration admission. |
| MigrationHandlerError from @zero/framework/migrations | [Migration declarations](../../../backend/migrations/declarations.md): safe MIGRATION_HANDLER_INVALID synchronous-handler contract and direction. |
| ObservabilityConfigurationError from @zero/framework/observability | [Observability config](../../../backend/observability/configuration.md): finite retention/payload admission, OBSERVABILITY_CONFIG_INVALID. |
| PdfServiceOptions.emitCode on @zero/framework/pdf | [PDF adapters](../../../backend/pdf/adapters.md): optional standalone app-bound event dependency; managed composition supplies its own. |
| VectorServiceOptions from @zero/framework/vector | [Vector composition](../../../backend/vector/composition.md): optional standalone emitCode construction dependency; managed service/default adapter binds to its required owned runtime. |
| @zero/framework/components/json-editor; JsonEditor and JsonEditorProps/Handle/CommitResult also through root/React | [JSON editing](../../../frontend/components/json-editor.md): the selected packaged JSON editor, token-themed local draft admission; not server persistence or a general code editor. |
| TableProps through @zero/framework/components/ui/table | [Semantic table](../../../frontend/components/primitives/tables-and-pagination.md): additive containerClassName when an ancestor owns scrolling; default wrapper unchanged. |
| ResizablePanelGroup/Panel/Handle through root/React and @zero/framework/components/ui/resizable | [Resizable panes](../../../frontend/components/primitives/resizable.md): themed wrapper around the established library's pointer/keyboard/ARIA behavior. |

Existing VectorRegistry/ZvecAdapter constructor options and VectorPluginConfig
also admit an optional emitter in corrected development source; their options
are visible through public constructor/function types, not newly named barrel
exports. Caller-created service/custom-store telemetry is not silently retargeted.
VECTOR_SCOPE_CONFLICT and VECTOR_BACKPRESSURE extend the existing VectorError
code union without creating a new runtime import. PlatformTokenError was
already public; finite duration/expiry admission is a behavior correction, not
a newly exported token helper.

Token expiry helper, notification/room JSON parsers and modal callback helper
remain implementation-private; no public import is inferred from their files.

## Complete CodeBlock Working-Source Paths

The original table/JSON is historical 2.1.1 extraction. The 2.4.0-baseline
feature branch adds these exact pure paths and expands the existing CodeBlock
family entry/root/React re-export. It remains dirty and must be extracted again
against the frozen artifact; these records do not assert publication.

| Package path | Public target | Canonical guide |
| --- | --- | --- |
| `@zero/framework/components/code-block` | [Complete family](../../../../src/components/code-block/index.ts) | [Overview](../../../frontend/components/public-pages/code-block.md) |
| `@zero/framework/components/code-block/server` | [Pure preparation](../../../../src/components/code-block/code-block-server.ts) | [Server/rendering](../../../frontend/components/public-pages/code-block-rendering.md) |
| `@zero/framework/components/code-block/highlight` | [Shared highlighting](../../../../src/components/code-block/code-block-highlight.ts) | [Highlighting](../../../frontend/components/public-pages/code-block-rendering.md) |
| `@zero/framework/components/code-block/metadata` | [Bounded metadata](../../../../src/components/code-block/code-block-metadata.ts) | [Metadata](../../../frontend/components/public-pages/code-block-rendering.md) |

## Optional Documentation Package Working Paths

These are separate `@zero/plugin-docs` 0.1.0 facades, requiring compatible
framework 2.5.0. They are not new mandatory framework services or additions to
the historical 2.1.1 framework export count. Actual installed/compiled
qualification is scoped in the [ledger](../docs-plugin-qualification.md);
registry/main release is still separate.

| Package path | Owning entry | Canonical guide |
| --- | --- | --- |
| `@zero/plugin-docs` | [Server factory](../../../../packages/docs/src/index.ts) | [Plugin index](../../../plugins/docs/index.md) |
| `@zero/plugin-docs/content` | [Content tooling](../../../../packages/docs/src/content/index.ts) | [Publication](../../../plugins/docs/publication.md) |
| `@zero/plugin-docs/react` | [Reader composition](../../../../packages/docs/src/ui/index.ts) | [Reader](../../../plugins/docs/reader.md) |
| `@zero/plugin-docs/styles.css` | [Docs roles/layout](../../../../packages/docs/src/ui/docs.css) | [Reader](../../../plugins/docs/reader.md) |

## Phone Input Working-Source Path

The dirty 2.5.0 source at `39c0ed1de0501986810a2b99366f484e66ba80dc` adds
`@zero/framework/components/phone-input` with `PhoneInput`, `PhoneInputProps`
and `PhoneInputSize`, also re-exported from root/React. `/schema` adds the
`PhoneFieldOptions` type and `isPhoneNumber`/`isPhoneCountry` helpers with
`PhoneCountry`/`PhoneNumberValidation`; root/React also export those helpers
and helper types. `field.phone` is an additive method on the existing namespace,
not a new SQL type or Guardian property API. Shared `InputProps` adds
`wrapperClassName` and retains native `readOnly`. The
[phone guide](../../../frontend/components/phone-input.md) owns the new component;
[schema](../../../backend/schema/fields.md) owns admitted field values. These
records do not assert that the published 2.5.0 archive contains these changes.

## Review Gates

Supplemental adaptive-settings source adds three explicit component paths:

| Public path | Owner | Guide |
| --- | --- | --- |
| `@zero/framework/components/avatar-group` | [Avatar presentation entry](../../../../src/components/avatar-group/index.ts) | [Avatar group](../../../frontend/components/avatar-group.md) |
| `@zero/framework/components/settings-matrix` | [Choice matrix entry](../../../../src/components/settings-matrix/index.ts) | [Settings matrix](../../../frontend/components/settings-matrix.md) |
| `@zero/framework/components/integration-settings-list` | [Integration presentation entry](../../../../src/components/integration-settings-list/index.ts) | [Integration list](../../../frontend/components/integration-settings-list.md) |

The React/root facade also exports these components and their public types.
These are working-source records after the session correction at `43b718a`,
not a claim that a new package was published. Existing plain Avatar, forms,
menus and status services remain separate contracts.

- [ ] Every non-test target assigned to an inventory and canonical feature home.
- [ ] Mixed-barrel symbols reconciled, aliases and internal annotations classified.
- [ ] Exact archive paths and public imports checked against a qualified artifact.
- [ ] Public documentation projection does not ship this working catalog/data.
