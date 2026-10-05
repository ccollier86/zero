# Component Inventory

Zero's component tree is intentionally broad, but it currently mixes several
different abstraction levels in one `src/components` folder. Use this inventory
as the working map before adding, moving, copying, or replacing shared UI.

## Component Philosophy

Zero UI should make the polished path the default path. Animate UI is not a
decorative add-on sitting beside the platform; it is the preferred source layer
for rich interaction when it provides the right primitive or composition.

The intended stack is:

| Layer | Responsibility |
| --- | --- |
| Zero public API | Stable imports and docs for apps and agents. Apps should use Zero paths, not raw internal Animate UI source paths. |
| Animate UI source | Preferred implementation source for animated Radix primitives, icons, menus, sidebars, dialogs, tooltips, tabs, toggles, and tasteful interaction effects. |
| Zero token layer | Shared light/dark/system design contract with a quiet core app lane and a richer public/frontend lane. |
| Zero polish layer | Consistent animation, icon trigger behavior, accessibility defaults, app-ready names, and framework-specific wiring. |

When Animate UI offers multiple versions of a pattern, Zero chooses one
platform default and documents the stable Zero import. Keep alternate Animate
UI variants as specialty components or source references until the platform
explicitly promotes them.

When Animate UI does not provide the component, build the Zero component with
the same standards: tokenized styling, restrained motion, accessible states,
animated icons where useful, and clean light/dark behavior. Operational UI
should feel alive and responsive without becoming decorative noise.

Reusable components must not introduce one-off palettes. Use platform tokens
such as `background`, `card`, `popover`, `muted`, `accent`, `primary`,
`border`, `ring`, `success`, `warning`, and `destructive`. If a component needs
new visual vocabulary, add it to the token contract before spreading custom
classes through the component tree.

## Layer Model

| Layer | Purpose | Default import style | Examples |
| --- | --- | --- | --- |
| Base primitives | Small tokenized building blocks. Prefer these over raw HTML controls. | `@zero/framework/components/ui/button` or `@zero/framework/react` | `Button`, `Input`, `Select`, `Card` |
| Composed primitives | Small multi-part controls built from base primitives or Radix. | `@zero/framework/react` | `DatePicker`, `Combobox`, `TagInput`, `CommandDialog` |
| Layout primitives | Reusable page and panel structure, not app-specific. | `@zero/framework/react` | `DetailPanel`, `ListDetailLayout`, `RecordNavigationBar` |
| Public navigation | Public-page navigation for marketing/docs/content routes. | `@zero/framework/components/navbar` or `@zero/framework/react` | `ResizableNavbar` |
| Public heroes | Public-page opening sections with background slots and actions. | `@zero/framework/components/hero` or `@zero/framework/react` | `Hero`, `HeroBackground`, `HeroImageBackground` |
| Public text effects | Public landing/docs/content text motion. | `@zero/framework/components/text-effects` or `@zero/framework/react` | `TextGenerateEffect`, `TypewriterEffect`, `FlipWords` |
| Streaming and agent output | Accessible text that follows a real string stream or caller-owned progressive value. | `@zero/framework/components/streaming-text` or `@zero/framework/react` | `StreamingText` |
| Sensitive-value display | Display-only masking, reveal policy, and full-value copy for a secret already authorized into browser memory. | `@zero/framework/components/secret-field` or `@zero/framework/react` | `SecretField` |
| Structured JSON editing | Controlled local document, retained unfinished text and explicit complete-document admission; domain controllers own persistence. | `@zero/framework/components/json-editor` or `@zero/framework/react` | [`JsonEditor`](./json-editor.md) |
| Public content sections | Landing/docs/content sections using the public token lane. | `@zero/framework/components/*` or `@zero/framework/react` | `FeaturesSection`, `CodeBlock`, `CtaSection`, `FooterSection`, `Faq`, `ExpandableCards`, `BentoGrid`, `AnimatedList` |
| App shell | Default app chrome for dashboards, admin tools, and data apps. | `@zero/framework/components/app-shell` | `AppShell`, `AppShellSidebar` |
| Data organisms | Feature-complete screens or major widgets wired for schemas/live data. | `@zero/framework/react` | `DataTableView`, `KanbanBoard`, `MasterDetailView`, `CrudPage` |
| Domain organisms | Platform feature UI with backend/client assumptions. | `@zero/framework/react` | `UserManagement`, `PlatformUserManagement`, `ApiKeyManagement`, `PlatformWorkspaceManagement`, `TenantMemberManagement`, `TenantOnboardingManagement`, `StorageManagement` |
| Animate UI wrappers | Animated Radix/components/effects/icons brought in as platform assets. | `@zero/framework/components/*`, `@zero/framework/icons` | `DropdownMenu`, `Sidebar`, `ZeroIcon` |

## Use-First Rules

1. Start with `AppShell` for dashboard/admin/data apps.
2. Start with `ResizableNavbar` for public landing/docs/content page navigation.
3. Start with `Hero` for public route opening sections.
4. Use `TextGenerateEffect`, `TypewriterEffect`, and `FlipWords` for public
   text motion instead of custom one-off heading animations.
5. Use `StreamingText` for AI/agent output and other real string streams. Use
   `TypewriterEffect` only for deliberate presentation, not to delay live data.
6. Use `SecretField` to display an authorized API key, token, or signing secret;
   masking is not a substitute for server authorization or safe delivery.
7. Use `FeaturesSection`, `CodeBlock`, `CtaSection`, `FooterSection`, `Faq`, `ExpandableCards`, `BentoGrid`,
   and `AnimatedList` for common public content sections before copying
   external snippets.
8. Use base `ui/` primitives instead of raw HTML controls.
9. Use generated/data organisms when a schema or collection exists.
10. Use Animate UI Radix wrappers for overlays and menus instead of duplicating
   Radix setup.
11. Use Zero animated icons by default. Use `lucide-react` directly only when an
   icon is not in Zero's animated set.
12. Keep app-specific source outside `src/components`; promote only reusable
   components with docs and export decisions.

## Base Primitives

These are the lowest-level app-facing controls in `src/components/ui`.

| Component | File | Role |
| --- | --- | --- |
| `Button`, `buttonVariants` | `ui/button.tsx` | Shared action primitive with variants and whole-button animated icon triggers. Avoid wrapping button icons in nested `AnimateIcon`; the button owns the trigger. |
| `Input` | `ui/input.tsx` | Tokenized single-line input with pointer-local border highlight and subtle focused border state. |
| `Textarea` | `ui/textarea.tsx` | Tokenized multi-line input. |
| `Label` | `ui/label.tsx` | Accessible label primitive. |
| `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator` | `ui/select.tsx` | Tokenized dropdown select. Use this instead of native `<select>` in platform UI. |
| `Checkbox` | `ui/checkbox.tsx` | Animated checkbox from Animate UI/Radix, available at `@zero/framework/components/ui/checkbox`. |
| `Switch` | `animate-ui/components/radix/switch.tsx` | Animated binary toggle from Animate UI/Radix. Currently not wrapped in `ui/`. |
| `RadioGroup`, `RadioGroupItem` | `ui/radio-group.tsx` | Animated radio group from Animate UI/Radix, available at `@zero/framework/components/ui/radio-group`. |
| `Progress` | `ui/progress.tsx` | Animated progress indicator available at `@zero/framework/components/ui/progress`. |
| `Toggle`, `ToggleGroup` | `animate-ui/components/radix/toggle*.tsx` | Animated pressed-state controls from Animate UI/Radix. |
| `Badge`, `badgeVariants` | `ui/badge.tsx` | Small status/tag primitive. |
| `Avatar`, `AvatarImage`, `AvatarFallback` | `ui/avatar.tsx` | User/avatar primitive. |
| `Skeleton` | `ui/skeleton.tsx` | Loading placeholder. |
| `Separator` | `ui/separator.tsx` | Horizontal/vertical divider. |
| `ScrollArea`, `ScrollBar` | `ui/scroll-area.tsx` | Tokenized custom scroll area. |
| `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption` | `ui/table.tsx` | Semantic table primitives. |

## Containers And Navigation

| Component | File | Role |
| --- | --- | --- |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | `ui/card.tsx` | Standard section/card container. Avoid nesting cards inside cards. |
| `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`, `BreadcrumbEllipsis` | `ui/breadcrumb.tsx` | Low-level breadcrumb primitives. |
| `Pagination`, `PaginationContent`, `PaginationItem`, `PaginationLink`, `PaginationPrevious`, `PaginationNext`, `PaginationEllipsis` | `ui/pagination.tsx` | Page navigation primitives. |
| `DropdownMenu` and subparts | `components/dropdown-menu` | Public animated dropdown menu wrapper. Prefer this over raw Radix menu. |
| `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverClose` | `components/popover` | Public token-aware popover wrapper, including the narrow `@zero/framework/components/popover` import used by table controls. |
| `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` | `components/collapsible` | Public animated collapsible wrapper. |
| `Tooltip`, `TooltipTrigger`, `TooltipContent` | `components/tooltip` | Public Zero/Radix tooltip for accessible control descriptions, including icon-only actions. |
| `ResizableNavbar` | `components/navbar` | Public-page navbar that detaches/shrinks on scroll and uses magnetic hover highlighting between links. |
| `Hero`, `HeroBackground`, `HeroImageBackground`, `WavyBackground` | `components/hero` | Public-page hero section with tokenized background presets, custom background slot, actions, wavy canvas background, and rich title support. |
| `TextGenerateEffect`, `TypewriterEffect`, `FlipWords` | `components/text-effects` | Public text effects for Hero titles, landing copy, docs headers, and content pages. |
| `StreamingText` | `components/streaming-text` | Accessible static, replayed, caller-owned, or async streamed text for AI and agent output. The default cursor uses the semantic `foreground` token. |
| `CodeBlock` | `components/code-block` | Tokenized Shiki code block with tabs, line numbers, copy action, and observability-backed fallback. |
| `CtaSection` | `components/cta` | Public call-to-action section with title, supporting copy, and Hero-compatible actions. |
| `FooterSection` | `components/footer` | Full-width public footer band with brand, labeled nav links, Hero-compatible actions, supporting action copy, copyright, and animated icon links. |
| `FeaturesSection` | `components/features` | Public feature showcase with icon bullets and a flexible image/code/custom visual slot. |
| `Sidebar` primitives | `components/sidebar` | Public low-level Animate UI sidebar wrapper. Use directly only when `AppShell` is not enough. |
| `AppShell`, `AppShellHeader`, `AppShellBreadcrumbs`, `AppShellSidebar` | `components/app-shell` | App-ready shell with workspace switcher, sidebar nav, breadcrumbs/header row, actions, footer/user menu, and theme toggle. |

## Public Page Components

These are for public websites, documentation, landing pages, and content
surfaces. They should use the public/frontend token lane from
[Design Tokens](./design-tokens.md) while still sharing the base primitives,
radius, font, and light/dark behavior used by dashboard components.

| Component | File | Role |
| --- | --- | --- |
| `Hero` | `hero/hero.tsx` | Full-bleed public hero section using the public token lane, rich title slot, description, actions, and optional child content. |
| `HeroBackground`, `HeroImageBackground` | `hero/hero-background.tsx` | Built-in preset backgrounds plus custom/image background helpers for Hero and future public sections. |
| `WavyBackground` | `hero/wavy-background.tsx` | Canvas-driven wave background used by the `wavy` Hero preset and available for custom Hero backgrounds. |
| `ResizableNavbar` | `navbar/resizable-navbar.tsx` | Fixed public navbar that detaches into a floating blurred capsule after scroll, includes desktop magnetic hover state, mobile menu, brand slot, links, and actions. |
| `TextGenerateEffect`, `TypewriterEffect`, `FlipWords` | `text-effects/*` | Motion text effects for public headings, Hero slots, and content page accents. |
| `CodeBlock` | `code-block/code-block.tsx` | Public code surface with Shiki highlighting, optional file tabs, line numbers, and copy action. |
| `CtaSection` | `cta/cta-section.tsx` | Compact public CTA surface with optional eyebrow, title, description, and Hero-compatible actions. |
| `FooterSection` | `footer/footer-section.tsx` | Full-width public footer band with brand block, optional link/action/social labels, optional action copy, social links, and copyright text. |
| `FeaturesSection` | `features/features-section.tsx` | Public feature section with content column, icon bullets, and flexible visual slot for images, screenshots, code blocks, charts, or custom React. |
| `Faq` | `faq/faq.tsx` | Public FAQ accordion with optional generated answer text. |
| `ExpandableCards` | `expandable-card/expandable-card.tsx` | Shared-layout card expansion for public feature cards, case studies, and content teasers. |
| `BentoGrid`, `BentoGridItem`, `BentoGridSkeleton` | `bento-grid/bento-grid.tsx` | Tokenized public bento grid adapted from the Aceternity pattern. |
| `AnimatedList`, `AnimatedListItem`, `AnimatedListCard` | `animated-list/animated-list.tsx` | Magic UI style sequenced reveal list with a tokenized event-card skin. |

## Forms And Generated Input UI

See [Form Library](./forms.md) for current boundaries, known gaps, and the
intake-grade roadmap. Keep `AutoForm` focused on CRUD and grow complex public
intake behavior through the planned blueprint/draft/attachment layer.

| Component | File | Role |
| --- | --- | --- |
| `FormField`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage` | `ui/form-field.tsx` | Field layout and aria glue. |
| `FieldRenderer` | `forms/field-renderer.tsx` | Renders schema fields into appropriate controls. |
| `AutoForm` | `forms/auto-form.tsx` | Schema-driven form generator. |
| `Wizard` | `forms/wizard.tsx` | Multi-step form composition. |
| `PasswordInput`, `PasswordStrength`, `OTPInput`, `OTPVerification` | `auth/*` | Auth-focused input controls. |
| `QRCode` | `qr-code/qr-code.tsx` | Token-aware QR primitive for authenticator setup and other app-owned QR flows. |
| `ValidationRules`, `ValidationMeter` | `ui/validation-*.tsx` | Password/validation display primitives. |

## Composed Inputs

| Component | File | Role |
| --- | --- | --- |
| `Calendar` | `ui/calendar.tsx` | Calendar primitive backed by react-day-picker. |
| `DatePicker` | `ui/date-picker.tsx` | Typed U.S. numeric date input + popover + calendar. Valid `M/D/YYYY` and `M-D-YYYY` input normalizes to the long display; `calendarProps` owns bounded month/year navigation and disabled dates. |
| `DateRangePicker` | `ui/date-range-picker.tsx` | Range picker composition. |
| `TimePicker` | `ui/time-picker.tsx` | Accessible hour/minute/period input that emits canonical `HH:mm`. |
| `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator`, `CommandShortcut` | `ui/command.tsx` | cmdk command palette primitives. |
| `Combobox` | `ui/combobox.tsx` | Searchable select, including grouped/multi options. |
| `TagInput` | `ui/tag-input.tsx` | Chip-based tag entry. |
| `SecretField` | `secret-field/secret-field.tsx` | Display-only secret with bounded prefix/suffix masking, controlled or uncontrolled reveal state, and full-value copy. The raw value remains in authorized browser memory; see [Secret Field](./secret-field.md). |
| `JsonEditor` | `json-editor/json-editor.tsx` | Token-themed `json-edit-react` wrapper with structured/text drafts, validation and local commit handle. It does not save, run code or deploy schemas; see [JSON Editor](./json-editor.md). |

## Feedback And Status

| Component | File | Role |
| --- | --- | --- |
| `Toaster` | `ui/sonner.tsx` | Zero-themed Sonner host. Mount once under `ThemeProvider`. |
| `toast` | `sonner` via `@zero/framework/react` | Imperative toast API. |
| `ThemeProvider` | `ui/theme-provider.tsx` | Theme persistence and class management. |
| `ThemeTogglerButton` | `animate-ui/components/buttons/theme-toggler.tsx` | Accessible light/dark/system toggle with a single morphing sun/moon SVG, click-origin circular View Transition, reduced-motion handling, and an immediate fallback. Integrated into `AppShell` via `header.themeToggle`. |
| `StreamingText` | `streaming-text/streaming-text.tsx` | Streaming status, tokenized cursor, and sentence-level polite announcements for live text. |
| `SecretField` | `secret-field/secret-field.tsx` | Accessible reveal and clipboard status for an already-authorized secret; callbacks never receive the copied value. |
| `NotificationBadge` | `ui/notification-badge.tsx` | Badge/dot counter overlay. |
| `NotificationItem` | `ui/notification-item.tsx` | Single notification row. |
| `NotificationList` | `ui/notification-list.tsx` | Grouped notification list. |
| `NotificationDropdown` | `ui/notification-dropdown.tsx` | Popover notification panel. |
| `NotificationCenter` | `ui/notification-center.tsx` | Complete bell + badge + dropdown composition. |

## Display And Dashboard Primitives

| Component | File | Role |
| --- | --- | --- |
| `StatCard` | `ui/stat-card.tsx` | Metric card with trend display. |
| `Chart` | `ui/chart.tsx` | Recharts wrapper and theme bridge. |
| `DetailPanel` | `ui/detail-panel.tsx` | Detail surface for a selected record/object. |
| `ListDetailLayout` | `ui/list-detail-layout.tsx` | Split list/detail layout. |
| `RecordNavigationBar` | `ui/record-navigation-bar.tsx` | Previous/next record navigation. |

## Data Organisms

| Component | File | Role |
| --- | --- | --- |
| `DataTableView`, `DataTable` | `data-table/data-table.tsx` | Schema-aware table organism with full-sync/lazy/custom/isolated-server sources, controlled state, acknowledged mutations, offset/cursor pagination, stable sizing, and a responsive toolbar; `DataTableView` is preferred. |
| `DataTableControls` | `data-table/data-table-controls.tsx` | Table-independent responsive shell for optional search, controls, actions, and supplemental React-node slots; forwards div attributes and owns no query state. |
| `DataTableSearch` | `data-table/data-table-search.tsx` | Compact expanding searchbox for table and management-directory toolbars, with Escape/Enter and reduced-motion behavior. |
| `DataTableToolbar` | `data-table/data-table-toolbar.tsx` | Search, generated filters, active-filter feedback, selection-aware `controls`/`actions`/`supplemental` slots, column visibility, and export actions. |
| `DataTablePagination` | `data-table/data-table-pagination.tsx` | Table pagination controls. |
| `DataTableRowActions` | `data-table/data-table-row-actions.tsx` | Row action dropdown. |
| `DataTableBulkActions` | `data-table/data-table-bulk-actions.tsx` | Awaited page-scoped actions plus an explicit low-level all-matching target contract. |
| `DataTableColumnHeader` | `data-table/data-table-column-header.tsx` | Sortable/filterable header. |
| `EditableCell`, `AnimatedCell` | `data-table/*cell.tsx` | Inline editing and value transition cells. |
| `KanbanBoard`, `KanbanTaskCard` | `kanban/kanban-board.tsx` | Drag-and-drop board organism for status/work queues. |
| `MasterDetailView`, `MasterDetailPage` | `master-detail/master-detail-page.tsx` | List/table + detail organism with DataTable-compatible `source`, search options, and `tableToolbarSlots` support. |
| `CrudPage` | `crud-page/crud-page.tsx` | Schema CRUD page/organism using DataTable, generated forms, and forwarded `tableToolbarSlots`. |
| `DataStudio`, `DataStudioWorkspace`, `DataStudioGrid`, `DataStudioToolbar`, `DataStudioFilterControl`, `DataStudioInspector`, `DataStudioInlineCell`, `DataStudio*Dialog` | `data-studio/*` | Guardian/Fabric organization-owned spreadsheet control plane with schema headers, progressive bounded reads, acknowledged cell editing, contextual columns, Visual/JSON schema drafts and optional record/table inspector. See [Data Studio](../data-studio.md). |

## Platform Domain Organisms

| Component | File | Role |
| --- | --- | --- |
| `LoginForm`, `RegisterForm`, `ForgotPasswordForm`, `EmailVerificationForm`, `ChangePasswordForm`, `PasswordActionForm` | `auth/*form.tsx` | Auth flow blocks. Session-producing login, registration, email-verification, and password-action responses route through `AuthFlowContinuation`, so MFA and tenant continuation requirements cannot be skipped. |
| `AuthFlowContinuation`, `TenantSelectionForm`, `TenantCreationForm`, `TenantInvitationForm`, `TenantJoinRequestForm`, `DomainOnboarding` | `auth/auth-flow-continuation.tsx`, `auth/tenant-*.tsx`, `auth/domain-onboarding.tsx` | Composed post-authentication continuation and onboarding surfaces for tenant selection, tenant creation, invitations, join requests, and verified-domain admission. Prefer `AuthFlowContinuation` when handling a Zero auth result instead of assembling these steps by hand. |
| `MFAContinuation`, `MFAEnrollmentForm`, `MFAChallengeForm`, `MFAManagementPanel` | `auth/mfa-*.tsx` | First-party email OTP/authenticator setup, challenge verification, and current-user MFA settings surfaces. |
| `AuthLayout`, `AuthHeader`, `PasswordInput`, `PasswordStrength`, `OTPInput`, `OTPVerification` | `auth/*` | Auth page shell, headers, password affordances, and OTP entry primitives. `AuthLayout` owns the full brand/card entrance animation; individual forms should only animate validation, loading, and success state changes. |
| `Gate`, `AdminGate`, `SignedIn`, `SignedOut`, `HasFlag`, `HasProperty`, `PropertyGate`, `PermissionGate`, `TenantGate`, `AdministrationScopeGate`, `PlatformAdminGate` | `auth/gate.tsx`, `auth/authorization-gates.tsx` | UI visibility gates for identity, metadata, permissions, active-tenant scope, the protected Administration Organization, and the global identity-admin role. `PermissionGate` checks active-scope plus optional administration application-scope permissions; `TenantGate` remains active-tenant-only and can require tenant kind. These improve presentation only; server routes and resources must still enforce authorization. |
| `UserPropertiesForm` | `auth/user-properties-form.tsx` | User metadata editor. |
| `TenantSwitcher`, `useTenantAppShellWorkspaces` | `auth/tenant-switcher.tsx`, `frontend/client/tenant-switch-presentation.ts` | Active-tenant controls for standalone and AppShell chrome. Both share Zero's session-switch presentation coordinator, preserve the server-committed selection, and use the official scope-replacement flow rather than app-owned token manipulation. |
| `DataRealmReadyGate`, `DataRealmReadinessNotice` | `auth/data-realm-ready-gate.tsx` | Optional Guardian/Fabric readiness boundary and token-driven pending/failure/retry presentation. The gate keeps collection-owning children unmounted until the server-derived realm is ready while Guardian navigation, switching, and logout remain outside it. |
| `ApiKeyManagement`, `SelfApiKeyManagement`, `ApplicationUserApiKeyManagement`, `TenantMemberApiKeyManagement`, `PlatformApiKeyManagement` | `auth/api-key-management*.tsx` | Optional developer-placed Guardian user API-key controls. The discriminated base component and thin mode wrappers adapt to public config plus exact server-projected mutation capabilities, preserve identity/tenant/live-RBAC/target cache boundaries, provide bounded lifecycle actions, and clear one-time secrets explicitly. They are never inserted into an app layout automatically; custom UI can use `useAuthApiKeys`. |
| `PlatformWorkspaceManagement` | `auth/platform-workspace-management.tsx` | Compact customer-organization master/detail directory with create/lifecycle actions and a focused Manage/View people list-detail surface. Member roles/effective access stay in the right pane; membership/ownership actions stay in the bottom bar; Add member is a dialog. It does not grant customer application-data access or tenant managers global account-security authority. |
| `TenantMemberManagement`, `TenantOnboardingManagement`, `TenantDomainManagement` | `auth/tenant-*-management.tsx` | Focused capability-aware active-tenant primitives for membership, roles, invitations, join requests, and verified-domain claims. `TenantMemberManagement` exposes detail/action composition seams so account security and invitation workflows can remain inside one people control plane. |
| `ControlPlaneAuditViewer` | `auth/control-plane-audit-viewer.tsx` | Filterable control-plane audit history for authorized platform and tenant administrators. |
| `UserManagement`, `PlatformUserManagement` | `admin/users/adaptive-user-management.tsx` | The same master/detail people control plane adapts from the established single/simple identity manager to integrated single/advanced application RBAC, customer-organization membership/RBAC, or Administration Organization people/workspace scope. Account security/properties and membership/application roles share the selected-person detail; lifecycle commands stay in the bottom action bar and add/invite/create workflows use focused dialogs. Platform navigation follows live application capabilities, including the supported create-only workspace state. `PlatformUserManagement` is an explicit alias, not a separate UI. |
| `IdentityUserManagement` | `admin/users/user-management.tsx` | Explicit established global-identity/account organism for controlled integrations that intentionally do not want auth-profile adaptation. |
| `StorageManagement` | `storage/storage-management.tsx` | Full storage management organism with drive settings, permissions, file browsing, dropzone uploads, filtered/sorted folders, and presigned download links. |
| `StorageDriveList`, `StorageDriveDetail`, `StorageDriveSettingsPanel`, `StorageDrivePermissionsPanel`, `StorageDropzone`, `StorageFileBrowser`, `StorageDriveDetailHeader`, `StorageFileDetailPanel` | `storage/*` | Storage subcomponents for custom storage UIs. Use these before writing bespoke storage admin screens. |

Data Studio is documented in [Data Studio](../data-studio.md). Its
`capabilities` prop is UI-only narrowing; server permissions remain
authoritative. Its inspector includes compact Record, Schema, and
syntax-highlighted/copyable Code tabs. Use the packaged control plane or its
controller/subcomponents before creating an app-specific logical table editor.

## Animate UI Source Groups

Zero vendors/adapts Animate UI in `src/components/animate-ui`. These are not
all equal in platform status.

| Group | Path | Platform status |
| --- | --- | --- |
| Animated icons | `animate-ui/icons` | First-class default icon pack. Public via `@zero/framework/icons`. |
| Animated Radix wrappers | `animate-ui/components/radix` | Public through selected wrapper subpaths, such as sidebar, dropdown menu, and collapsible. Some primitives still need official Zero wrapper paths. |
| Animated buttons | `animate-ui/components/buttons` | Available internally; `ThemeTogglerButton` is first-class. Need decide which effect buttons should be public defaults. |
| Backgrounds | `animate-ui/components/backgrounds` | Visual effects. Use sparingly; not default for operational apps. |
| Community components | `animate-ui/components/community` | Useful source pool. `RadialMenu` is currently exposed as a public package path. |
| Text animations | `animate-ui/primitives/texts` | Source pool for marketing/editorial UI, not default dashboard chrome. |
| Effects primitives | `animate-ui/primitives/effects` | Low-level motion helpers used by wrappers. Use directly only when building reusable components. |

## Known Overlap And Cleanup Targets

| Area | Current overlap | Recommendation |
| --- | --- | --- |
| Button | `ui/button.tsx` and Animate UI button variants both exist. | Keep `ui/Button` as default app action. Expose effect buttons only as named specialty components. |
| Tooltip | `animate-ui/components/animate/tooltip.tsx` and the public `components/tooltip` Radix wrapper both exist. | Use `@zero/framework/components/tooltip` for UI controls; reserve the animated tooltip for decorative/demo contexts. |
| Tabs | Animate UI has animated tabs and animated Radix tabs. | Define one app-default `Tabs` path before telling agents to use tabs broadly. |
| Notification list | `ui/notification-list.tsx` and Animate UI community `notification-list.tsx`. | Keep Zero notification components as platform default because they know platform notification shape. Treat community version as source/reference only. |
| Sidebar | Raw Animate UI sidebar and Zero `AppShell` both expose sidebar pieces. | Default to `AppShell`; use raw sidebar only for custom shells. |
| Dialog/modal | Animate UI dialog exists, while app flows should use the platform modal manager. | Agents should use modal manager for app modals; direct dialog is for building reusable components or special cases. |
| Select/switch | Select has a `ui/` wrapper, while switch remains on an Animate UI/Radix path. | Add a Zero `ui/switch` wrapper when package-mode app use requires it. |
| App-specific organisms | Auth, admin, storage, data table, and kanban share `src/components`. | Keep until package structure stabilizes, but docs should label these as domain/data organisms, not base UI. |

## Proposed Organization Direction

Do not move files until public import compatibility is planned. The direction
should be:

| Future group | Contains |
| --- | --- |
| `components/ui` | Base primitives and composed controls. |
| `components/layout` | AppShell, detail layouts, navigation primitives. |
| `components/data` | DataTable, Kanban, MasterDetail, CrudPage. |
| `components/platform` | Auth, admin, storage, notification-specific organisms. |
| `components/animate-ui` | Vendored/adapted Animate UI source pool and wrappers. |

The public package paths can stay stable while internal folders improve.
