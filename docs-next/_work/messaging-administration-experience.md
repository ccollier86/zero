---
id: zero.work.messaging-administration-experience
type: architecture
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: messaging-management-experience
maturity: planned
applies_to: ["Proposed single management component after 2.10.1"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced, browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.10.1"
  commit: "7b151069835f841aca1542b2c8f02e7c3a66a6da"
  snapshot: clean
  date: "2026-11-04"
  evidence_level: source-observed
---

# Messaging Management Experience

[Working index](./index.md) · [System design](./messaging-administration-plan.md) · [Implementation and qualification](./messaging-administration-qualification.md)

One proposed `MessagingManagement` component renders the complete management
view inside the existing AppShell. It inherits the application's auth, active
organization, theme, router and overlay managers. Apps should not assemble
separate setup, role-picker, membership and settings pages to get the default.

## One workspace

Proposed composition, not an existing export or a runnable 2.10.1 example:

```tsx
// Inside the existing AppProvider and AppShell.
// Proposed future public import: @zero/framework/messaging.
<MessagingManagement />
```

The component adapts to current capabilities. Its internal Groups/Settings
navigation stays within one workspace and one owned controller. Do not add
another app sidebar or persistent left navigation beside AppShell. The host
chooses a route/sidebar label, for example Messaging settings; Zero Link keeps
the shared provider mounted. Optional route-state callbacks can support a
selected group/tab, but a URL is never authority or a tenant selector.

The desktop default follows the existing people/table control planes:

```text
Existing AppShell header and sidebar remain mounted
  Messaging                         Current organization
  Groups | Settings
  Search groups   Membership   Source   Status    New group
  Group table                    Selected group detail
  compact shared pagination      details / membership / history
                                 contextual actions and Save
```

This wireframe describes hierarchy, not hardcoded dimensions. Use the existing
DataTable/MasterDetail layout and compact theme density. Details collapse into
the managed responsive drawer/sheet on narrow screens, not a second management
component or a custom overlay. Settings replaces the table content within this
same workspace; it is not an unrelated dashboard of oversized mostly empty cards.

Proposed component options are presentational: class/height, initial view,
initial selected group and normal host selection callbacks. Never accept client
props that override current tenant, authorization, editable fields or deployment
locks. Export the focused hook/parts for deliberate custom composition, while
the no-configuration organism remains the primary path.

The app supplies backend delegation and its normal route; the component
discovers the admitted mode and renders the whole management view. Advanced
presentation overrides must not be prerequisites for a polished default.

## Groups table and details

Default columns are Name, Membership, Members, Status and Updated. Source is an
optional column and a standard filter. Name cells show a short optional
description and a source-lock badge only when meaningful. Member counts mean
confirmed current membership, not preview estimates or online counts.

Use ordinary DataTable search, server-backed filters/sort, standard page-size
options and total presentation. Default to 25 rows. Use the shared changed-digit
number presentation where counts change; do not render each digit on a separate
line or substitute an arbitrary unsupported page size. Unknown totals stay
unknown. Server totals/search refer to the authorized whole query, not a local
page. Bounds remain explicit when capacity is reached.

The selected detail contains:

- Name, description if supported, source and lifecycle status.
- Membership mode and a plain-language rule or explicit member summary.
- Current permitted members with native names and authorized avatar images;
  initials are fallback, not a fabricated public image URL.
- Join/rejoin history policy and a clear explanation of its future effect.
- Last accepted change, current generation and safe reconciliation status when
  it needs operator attention. Technical IDs are secondary inspectable details.
- Capability-derived edit/archive/restore controls. A chat shortcut appears
  only after a separate current participant check, never from management alone.

Do not display private peer conversations, their names or their participant
lists. The admin-managed table is not a covert transcript browser. Selecting
an administrator-managed group does not mark its messages read.

## Create a group

New group opens one managed drawer/wizard owned by the trigger, with three
short steps. The wizard remains in this component; it is not another page.

1. **Details:** name and Manual or Automatic membership. Explain that the group
   is an administrator-managed team conversation, not a user-owned chat.
2. **Membership and history:** choose eligible people for Manual, or compose an
   admitted Guardian requirement for Automatic. Choose the allowed history for
   future joins/rejoins. Show configuration locks and field-level help inline.
3. **Review:** show the complete human-readable policy, exact eligible member
   count, permitted people, joining-history warning and unavailable/capacity
   conditions. Create stays disabled until a current server preview is ready.

An empty valid automatic group can be created and says No one matches yet. A
manual group can remain a local unsaved draft while empty, but cannot activate
without a selected eligible member. Never add the administrator implicitly to
make the group look populated. Returning to an earlier step preserves drafts
and invalidates a preview if its relevant input changed.

Create shows pending state until the canonical acknowledgement. Then select
the accepted group in the same management view and close the wizard. A denied
or invalid change stays in context with actionable feedback. An unknown outcome
retains the original request identity and offers Check outcome; a retry cannot
create another group with a fresh identity.

## Edit automatic membership

Use a dedicated proposed Guardian requirement editor, composed from Zero's
shared Select, Popover, Input, token/chip choices and magnetic item highlight.
Reuse filter-control presentation patterns without treating SQL filter
operators as authorization logic. The current repository does not supply a
general Guardian rule-builder component; implementing this adapter is real work.

Show labeled sections matching the actual kernel:

- Must have one of these organization/application roles.
- Must have all these permissions.
- Must have at least one of these permissions.
- And match these approved properties.

Omit choices not delegated by the app. Typed conditions use meaningful labels,
operator restrictions and a concise generated sentence, such as Department is
Clinical and has permission to read clinical records. Do not imply a user gets
that permission by joining. Show no arbitrary cross-category OR/nesting which
the compiler cannot represent.

Apply changes requires a fresh impact preview. Display Added and Removed
counts, paged identities only when allowed, and the reason each category
changes. Otherwise display authorized aggregate information with a clear
membership-details restriction. Do not expose property values to explain a rule.
If the Guardian/configuration snapshot changes, mark the preview outdated and
offer Refresh preview; do not automatically apply a new audience.

## Edit explicit membership

Manual membership uses a searchable paged eligible directory and a selected
people list, with current photos where native avatar authorization permits.
No global account creation, cross-tenant lookup or arbitrary pasted account IDs
is part of this picker. Explain accounts which become ineligible using safe
categories without exposing private account/security details.

Apply changes previews additions/removals and joining history. The creator is
not a special permanent member, and group managers are not inserted as owners.
Automatic groups have no Add person workaround. The existing ordinary-chat
participant picker remains in `MessagingWorkspace`; do not replace it with an
administrator management form.

## Settings within the same component

Use compact labeled sections, current values and field-level source/lock help:

- Availability and its precise effect on reading/sending/recovery.
- Starting conversations and ordinary groups.
- Future-join history defaults and permitted message/file limits.
- Notification availability when its integration is installed.
- Readiness summaries for installed Support, AI, Storage, Fabric and Logging.

The last section shows actual readiness and links to existing authorized
management surfaces; it does not duplicate provider credentials or claim a
configured service delivered anything. Portal mode and undelegated fields are
read-only with a short explanation. Do not show unsupported working toggles.

Save is disabled until this settings form has genuine changes. Enter or
programmatic submit also does nothing when unchanged. Submit only changed
delegated fields. Reset to default shows which overrides are removed, and uses
the same preview/acknowledgment protocol for access-affecting changes.

Availability changes and other access changes show their effect before Apply.
Read only explains that existing authorized history/files remain available;
Paused explains that ordinary messaging is unavailable but data remains.
Resuming does not promise replay of unknown AI/provider operations.

## Drafts and real time behavior

Maintain separate accepted snapshots and local drafts by scope and record.
Unrelated presence, avatar or settings updates must not erase typing. Preserve
newer local edits while an earlier save awaits acknowledgement. A remote
conflict shows Review latest and retains the local draft; it does not overwrite
either side or claim a rollback.

Use the existing native scoped live projection pattern. Watch group summaries,
selected-group membership and settings separately so member/presence activity
does not refresh the whole table. Coalesce rapid hints and refresh the current
server query, retaining stable rows/selection and animating only actual inserted
rows or accepted count changes. Do not blank the table or rerun its first-load
animation on every membership change. Page movement keeps the native directional
transition. Unknown outcomes have a distinct status from server rejection.

On definitive read denial or scope/actor replacement, withdraw private rows,
details, cached pages, previews and owned overlays immediately, without an exit
animation retaining denied content. A same-scope transient outage may retain a
previously authorized read-only page with a stale/error banner; mutations stay
appropriately disabled and final authority remains server-owned.

## States and accessibility

| Situation | Required presentation |
| --- | --- |
| First authorized load | Native table/detail skeleton without invented counts. |
| No managed groups | Compact explanation, New group if permitted, and no artificial demo rows. |
| No search matches | Preserve filters, show Clear filters; do not offer unrelated onboarding. |
| Read-only administrator | Show permitted details with explicit locked actions, not an empty broken view. |
| No current organization | Existing Guardian organization-selection state; no guessed scope. |
| Management not enabled | Authorized setup guidance or access denial, not a client toggle that installs services. |
| Group has no matching members | Stable empty membership state; group/history remains intact. |
| Stale preview or revision conflict | Retain draft and require Review latest/Refresh preview before Apply. |
| Unknown write outcome | Check original request receipt; no blind new mutation. |
| Actor/storage/required-audit failure | Safe distinct status and supported recovery; no fabricated success. |
| Archived group | Retained metadata, no sends; authorized history follows its retained policy. |

Use default semantic tokens, typography and compact controls. Native icons come
from Zero; use an outside icon only if Zero has no equivalent. Preserve shared
magnetic hover/focus highlights in applicable menus, tabs and choices. Use native
Select/Popover motion, managed drawer motion and trigger/focus ownership; do
not invent a second animation vocabulary. Any overflowing overlay/body/list
uses the shared Arc ScrollArea treatment without nested conflicting scrollers.

Keyboard users can complete create, rule editing, review and apply. Provide
labels, validation association, visible focus, focus return and clear progress
announcements. Touch users see explicit actions without hover discovery. Honor
reduced motion, high zoom and mobile virtual keyboards. Do not announce every
realtime counter update as urgent or treat focus/presence as a read receipt.

## Related guides and next steps

- [System design](./messaging-administration-plan.md) owns scopes, facade,
  deployment ceilings and atomic policy/membership behavior.
- [Implementation and qualification](./messaging-administration-qualification.md)
  makes every management workflow a testable implementation/release gate.
- [People control plane](../frontend/guardian/people-control-plane.md) and
  [reactive control planes](../guides/reactive-control-plane.md) establish the
  shared adaptive layout and accepted-write presentation this view follows.
- [Managed drawers](../frontend/drawers/index.md) own overlay lifecycle; the
  management component must compose them, not add another manager.
