---
id: zero.work.messaging-administration-plan
type: architecture
audience: [developer, agent, maintainer, operator]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: messaging-management
maturity: planned
applies_to: ["Proposed extension after 2.10.1; no management API or component is implemented by this plan"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.10.1"
  commit: "7b151069835f841aca1542b2c8f02e7c3a66a6da"
  snapshot: clean
  date: "2026-11-04"
  evidence_level: source-observed
---

# Messaging Management Design

[Working index](./index.md) · [Management experience](./messaging-administration-experience.md) · [Implementation and qualification](./messaging-administration-qualification.md)

Provide one native `MessagingManagement` component inside the application's
existing AppShell. It manages the current installation's or organization's
messaging settings and administrator-managed groups through the Zero facade.
It is one adaptive management workspace, not another application shell, a
collection of disconnected dashboards, or permission to inspect private chats.

The component, configuration extension, schemas and API names below are
**proposed**. The inspected baseline already has peer/group conversations,
configuration-defined Guardian groups and the native chat workspace; it does
not have database-backed group administration or this management component.
The current qualified release and consuming applications remain unchanged.

## Product decisions

1. Ship one self-wired organism, `MessagingManagement`, with compact Groups and
   Settings navigation inside the workspace. The host owns its route and AppShell
   sidebar entry; optional embedded sections reuse the organism's controller.
2. Keep `MessagingWorkspace` for participating in chats. Managing group policy
   never implicitly opens a transcript or makes its administrator a member.
3. Offer administrator-managed groups with either an explicit member list or
   automatic Guardian membership. These are different from user-owned ordinary
   group chats, which retain their owner/leave/contact behavior.
4. Keep deployment configuration as the capability and delegation ceiling.
   Persist only explicitly delegated operational settings and group definitions.
   Do not create a general browser-editable `zero.config.ts` replacement.
5. Store each scope's definitions, settings, canonical membership and receipts in
   its existing private messaging Fabric database. Do not introduce a new
   settings database or put message/group data into SYSTEM or the app database.
6. Apply a group-definition change, its bounded membership difference, policy
   generation, durable intent receipt and source audit work in one realm commit.
   Guardian directory evaluation happens before that short transaction.
7. Use real current policy for every read, write, file, typing and stream release.
   Background membership maintenance is not an authorization grant.
8. Preview access-affecting edits before applying them. Report who would join or
   leave only to an actor with member-directory authority, and reject stale
   previews rather than applying a guessed result.
9. Preserve history, bytes, identities and receipts on pause/archive/disable.
   This feature has no bulk message deletion or retention editor.
10. Finish the backend and browser acceptance together. A static settings form,
    hidden controls or a successful unit test is not the management feature.

## Existing boundaries to extend

| Existing owner | Present behavior | Required addition |
| --- | --- | --- |
| [Configuration resolver](../../src/messaging/config.ts) | Resolves and freezes deployment configuration at startup. | Explicit delegation descriptor and immutable current-scope operational snapshots; no mutation of the startup object. |
| [Group configuration](../../src/messaging/group-config.ts) | Guardian requirements, stable IDs and policy hashes for configured groups. | A shared validator for delegated definitions, including source/provenance and revision. |
| [Group maintenance](../../src/messaging/groups.ts) | Coalesces Guardian revisions, scans bounded pages and reconciles canonical membership. | React to both definition and Guardian generations without rescanning for each message. |
| [Actor authority](../../src/messaging/authority.ts) | Captures current Guardian and configured group admission. | Include the relevant realm policy generation and exact definition revision in admission. |
| [Group writer](../../src/messaging/group-commands.ts) | Reconciles membership in a short tracked commit. | Atomically commit definition plus membership and reject outdated preview/generation. |
| [Conversation commands](../../src/messaging/conversation-commands.ts) | Ordinary owner-managed groups and private direct conversations. | Preserve this boundary; managed-group editing uses separate authorized admin commands. |
| [Facade](../../src/messaging/contracts.ts) and [transport](../../src/messaging/plugin.ts) | Participant APIs, current-scope HTTP and committed live projections. | Add a separate admin capability surface, without making transcripts administrator-readable. |
| [Workspace composition](../frontend/messaging/workspace.md) | One ordinary AppProvider and native conversation UI. | Add one management organism using that same provider and SDK. |

## Scope and permissions

Single tenancy resolves the application scope. Multi tenancy resolves the
current validated Guardian organization. No ordinary admin request accepts a
tenant ID to select another database. Changing organization retires the entire
management controller, queries, overlays, previews and drafts before replacement.

Deployment configuration explicitly supplies management requirements. Do not
infer management authority from transcript membership, presence, an account's
displayed role label or support assignment. Do not silently assign roles or
create permissions when the UI mounts. An app using new permission keys must
declare them in its Guardian registry and follow the normal registry upgrade.

Project granular capabilities through the server, with requirements at least
as restrictive as the configured management entrance:

| Capability | Permits | Does not permit |
| --- | --- | --- |
| Read management | Read allowed settings and managed-group metadata. | Read messages, private notes, attachments or private peer-chat titles. |
| Manage settings | Change delegated settings in this scope. | Start an uninstalled subsystem, change topology or edit deployment locks. |
| Manage groups | Create and edit delegated group definitions; archive/restore. | Change undelegated configured groups or grant Guardian permissions. |
| Manage members | Edit explicit membership within the group's allowed audience. | Add a cross-scope/ineligible account or override a mandatory audience rule. |
| Read members | Preview permitted people and membership reasons. | Read clinical/custom property values or arbitrary identity contact fields. |

Authorize the actual changed fields, not just the endpoint name. Creating an
active group requires group and membership management. Changing an automatic
rule is a membership operation just as adding an explicit person is; metadata
management alone cannot use it to bypass member controls. Rename needs only
group management. A member-only delegate cannot create a new definition or
change its deployment ceiling. Member-list read remains a separate projection
capability even when an actor can apply an allowed policy change.

The first implementation admits authenticated browser sessions only. Existing
native credential scopes and rejection of API keys must not accidentally become
admin authority. Machine/native management needs a separate explicit contract
and qualification; it is not implied by adding a facade method.

Organization managers do not gain global user administration. Platform
administrators do not acquire private tenant transcripts or automatic membership.
A platform operator who needs another organization's management follows a
separately admitted Guardian scope transition, not a hidden selector/body field.

## Deployment authority and dynamic settings

The proposed `messaging.administration` declaration enables the management
service, supplies its Guardian requirements and identifies delegated controls.
Exact TypeScript option names must be finalized with the implementation, not
copied from this plan as a runnable current configuration.

Configuration owns feature installation, actor launch/environment, private roots,
tenancy, Guardian permission meanings, approved rule fields, capacity ceilings,
support destinations and AI/provider availability. Those are not editable here.
Delegation can continuously constrain each group's audience and available
history policy. Combine mandatory and editable Guardian requirements
conjunctively through the existing compiler; never deep-merge them into a weaker
rule or try to prove arbitrary policy implication in the browser.

Make the distinction between administering access and being a participant
visible. A manager may configure only delegated audiences and may read messages
only after separate explicit membership within that audience. The UI cannot
edit the mandatory audience ceiling to make its operator eligible. A stricter
installation can also prohibit self-admission; this must be enforced by the
management writer, not just omitted from a picker.

In a delegated field, provenance is explicit: deployment-locked, deployment
default, or saved administrator override. Saved overrides survive restart and
redeployment. A changed seed default does not overwrite an override. Reset to
default is an explicit revision-checked command with an impact preview when
access changes. Invalid persisted state or an unavailable database must not
silently select a more permissive file/default value.

Disabling the administration UI/API after it has been used does not disable
enforcement of saved policy. Any retained-state marker requires the runtime to
load and validate the stored settings/definitions even when management writes
are now disabled. Removing delegation does not erase overrides or restore old
permissive defaults. Evaluate an explicit compatibility/reconciliation plan;
unknown registry fields or incompatible saved choices fail closed for the
affected group/operation with a management recovery path. Do not silently omit
an unparseable rule or quarantine unrelated private conversations.

### Settings in the initial management feature

| Control | Proposed behavior | Change boundary |
| --- | --- | --- |
| Availability | Active, read only, or paused, only where delegated. | Live policy generation; see lifecycle below. |
| New peer conversations | Everyone in the eligible directory or accepted contacts. | Applies to starting conversations and adding people; does not fabricate accepted contacts or erase existing chats. |
| Ordinary group creation | Allow or restrict initiation using an admitted Guardian requirement. | New group creation only; existing owner controls remain subject to current membership. |
| Adding ordinary participants | Keep owner management, optionally narrow eligible additions by deployment policy. | Check actor and target at commit; do not silently turn members into owners. |
| Default join history | All history or since joining, within the configured ceiling. | Future joins/rejoins, not retrospective rewriting of existing grants. |
| Message and upload limits | May narrow supported values within installation ceilings. | Future acceptance; existing messages/files remain intact. |
| Notification feature availability | Enable/narrow the installed integration if delegated. | Future notices; keep personal sound and quiet-conversation preferences separate. |

Portal/support-only mode is shown accurately but is deployment-controlled in
the first release. Switching an installed peer app into portal mode can retire
existing peer access and requires its existing deliberate retained-state
procedure. Do not hide that operation behind a harmless-looking dropdown.
Support routing and assistant configuration remain read-only summaries/links in
the first release. A later slice may delegate supported destination/model
selection, but it must not expose credentials, arbitrary prompts/tools or staff
assignment powers as part of group administration.

### Availability and recovery

- **Active:** normal currently authorized reads and writes.
- **Read only:** authorized history and private file reads remain; message,
  reaction, membership/contact mutations and new AI work stop. Typing stops.
  Previously dispatched external work is not described as unsent; publication
  and notification checks respect the new generation.
- **Paused:** ordinary discovery, transcripts, downloads and public support
  admission are unavailable. Authorized management and recovery remain reachable.
  Retain all files, messages, receipts and queued outcomes. Do not erase work or
  automatically replay uncertain provider effects when resuming.
- Deployment `messaging: false` continues to mean the subsystem is not started.
  The UI cannot boot actors or change that deployment decision. It shows an
  accurate unavailable/setup state only through already admitted app metadata.

These changes do not revoke an auth session or require another audit handshake
just because messaging settings changed. Real Guardian/session revocation still
applies. Public artwork, sign-in, health and unrelated application routes never
acquire a messaging management/admission gate.

## Administrator managed groups

Each definition owns one stable conversation, not channels or nested message
threads. A group name is editable presentation, not its identity. Sources are
`configuration` and `administration`; membership modes are `manual` and
`automatic`. Source and membership mode are separate attributes.

For manual groups, a manager selects eligible people. Additions are the
intersection of that list, current Guardian eligibility and the continuous
deployment audience ceiling. Administrator-managed members have member roles;
the manager does not become an ordinary conversation owner. Administrative
commands operate through their own authority rather than faking that ownership.

For automatic groups, all eligible people matching the effective Guardian
requirement join. No manual additions, exceptions or exclusions are offered in
the first release. A manager can edit the rule; changing an account's actual
role/property uses the separately authorized Guardian control plane.

Do not convert an existing ordinary group into a policy-managed group, expand
a private direct conversation, or merge histories. Those need a deliberate
future conversion contract. Ordinary private chats are not listed in this
management table. Configuration-defined groups are visible with locked fields;
their code-owned definitions are not silently copied into editable rows.

### Rules use Guardian exactly

Provide a new, reusable Guardian requirement editor using existing controls,
not the Data Studio SQL filter AST. Its permitted vocabulary is the current
[Guardian requirement](../../src/auth/authorization-policy-types.ts):

- Require one of the approved current-scope roles.
- Require all selected permissions and/or at least one selected permission.
- Match approved trusted properties using supported equality, inclusion,
  exclusion or existence conditions, with typed values and field bounds.

The separate conditions are ANDed; alternatives within a role/any-permission
list are ORed. Do not display unrestricted nested AND/OR, arbitrary JavaScript,
SQL, freeform JSON, platform roles or expressions the current kernel cannot
represent. Multi-tenant role labels always mean current organization roles.
Account-level trusted properties are not newly invented tenant properties.
Properties must be policy-trusted and specifically delegated for this editor.

Automatic team groups remain independent of accepted-contact requirements, as
configured groups are today. Explain this distinction. Do not silently weaken
ordinary direct/group invitation block checks or expose anyone's block list.
Presence and online status are never membership conditions.

### History and membership changes

Label the setting **History for future joins and rejoins**. `since-join`
establishes a canonical lower sequence boundary; `all` can include previous
messages and must be allowed by deployment policy and acknowledged in the
preview. Existing members keep their accepted lower bounds. Narrowing the
future-join default does not pretend to retract messages previously delivered.

Group archive is distinct from membership removal and scope pause: it prevents
new sends/edits while retaining separately authorized history. Restore rechecks
current definition and membership; it is not an owner-epoch reset or a replay
of prior assistant work.

Removal immediately prevents new authorized transcript/file/typing releases.
Rejoining gets the currently approved join policy, not an old read receipt as
permission. A history-policy change must not reset unread cursors, manufacture
read receipts or claim the person saw anything. Already delivered bytes cannot
be remotely recalled; authorized clients retire stale private presentation.

Membership mode is fixed once a group is active. A later explicit conversion
may be designed; a dropdown must not replace manual intent with an automatic
audience or silently drop members in this release.

### Preview and apply

1. Validate the draft against current deployment locks, delegated catalog and
   Guardian requirements. Compare expected definition/settings revisions.
2. Scan the eligible directory in bounded pages outside SQL/auth leases. Produce
   exact admitted additions/removals within current capacity, not a sample
   described as a total. Member names require separate permitted directory read.
3. Bind a short-lived preview receipt to actor, current scope, exact draft hash,
   Guardian authority revision, deployment digest and realm settings/definition
   generations. Its maximum lifetime is five minutes; it is not a reusable grant.
4. Show additions/removals, effect on future history and access restrictions.
   Only access-affecting changes require this review; a rename can use a normal
   acknowledged Save without a separate ceremony.
5. On Apply, recheck the receipt, authority, scope, revisions, eligible targets
   and ceilings. Stale/expired previews return a conflict requiring a new preview.
6. Commit the definition and bounded canonical membership difference together
   with the new policy generation and exact request receipt. Publish committed
   hints afterward. Report accepted state, not an optimistic preview as success.

An empty valid automatic group is allowed. A rule matching more than the
configured participant limit is rejected before activation, with no truncated
audience or partially created group. Retain the existing bounds: at most 100
participants per group, 32 managed groups per scope and 10,000 directory
candidates until a separate larger-capacity implementation is qualified.

## Persistence and source ownership

Use additive, versioned private messaging migrations. Proposed records:

| Record | Required private state |
| --- | --- |
| Scope settings singleton | Format version, monotonic revision, security policy generation, saved delegated values and deployment compatibility digest. |
| Managed group definition | Stable definition/conversation IDs, source, membership mode, label, effective requirement or bounded manual IDs, join history, revision, lifecycle and policy hash. |
| Preview receipts | Actor/scope/draft binding, relevant revisions, expiry and bounded computed member set. Private, size/rate limited and expendable; never authority alone. |
| Reconciliation state | Target definition and Guardian generation, progress/failure code, resumable desired work identity. Reuse existing durable work facilities where suitable. |
| Existing intents and outbox | Canonical accepted command identity/result plus transactional audit/reconciliation work. Do not create a second conflicting receipt system. |

Index definition identity, lifecycle/source, updated ordering and reconciliation
work. Bind cursors to scope, filter and sort. Owner metadata remains SYSTEM's
existing responsibility; Storage retains private file identity, Logging its own
Fabric databases and workers. There is no cross-database SQLite transaction.

Seed explicitly delegated defaults once per scope using a durable installation
receipt. Startup/restart validates compatibility and resumes recorded work;
it does not replay a wizard or overwrite administrator changes. A future
explicit adoption of a configured group must preserve its existing conversation
ID, history, sequence, attachment identity and read positions. Adoption is not
included in the first release; source-locked groups stay locked.

## Public facade proposal

Extend the existing client/request-scoped server facade with an `admin` branch.
These are proposed method families, not callable exports in 2.10.1:

| Proposed family | Responsibility |
| --- | --- |
| `client.messaging.admin.capabilities()` | Exact current-scope actions, delegated field metadata, provenance, locks, bounds and readiness. No secrets or transcript grant. |
| `admin.settings.get/update/reset` | Revisioned effective settings; accept only delegated fields; reset is deliberate. |
| `admin.groups.list/get/create/update/archive` | Bounded queryable definition metadata and exact accepted lifecycle operations. Archive uses a boolean for reversible archive/restore. |
| `admin.groups.members` | Authorized paged people and safe reasons, without messages/private custom values. |
| `admin.preview` | One tagged settings/group change draft, exact bound to current revisions and short expiry. |
| `admin.receipt` | Reconcile the original management request without requiring transcript membership. |
| `admin.watchSettings/watchGroups/watchMembers` | Authorized committed live projections with owned cancellation and terminal-denial handling. |

Server `zero.messaging.admin` uses the same validation, service and writer.
Mutations require an original stable `requestId` and expected revision; apply
also supplies its preview ID where required. Bound actor, operation, scope and
intent into the durable receipt. Do not trust client-provided actor IDs,
compiled policies, counts or effective capabilities.

Add thin native Elysia routes under `/api/messaging/admin`, with the existing
authenticated SDK transport, bounded strict input/query validation and stable
errors. They have their own management authorization, not participant handlers
which require membership. Public visitor transports never expose this branch.
Use private/no-store projections, current-session safeguards and required audit
admission without intercepting unrelated/public routes.

## Live policy and concurrency

Introduce an immutable scope policy snapshot resolver; do not mutate
`ResolvedMessagingConfig` or let a long-lived service closure keep old settings.
Separate a presentation/settings revision from the security policy generation:
renaming a group must not retire healthy authority or every transcript.
Cache keys include current scope, deployment digest, Guardian revision and the
relevant realm/group policy generation, never only an account ID.

Project admission to the operation being performed. A group-specific edit fences
that group's releases and membership operations, not unrelated direct chats or
another group's accepted work. Scope availability fences the whole messaging
scope. Do not compare the complete group-policy catalog on every direct-message
operation or turn an unrelated group rename into a stale-authority error.

Policy-changing writes need a bounded **realm-local messaging admission fence**:
retire old generation releases before dispatching the policy commit, publish
the new accepted generation after it, and reconcile an unknown commit before
reopening admission. A rejected write restores the known accepted generation,
not the proposed draft. Administrative receipt/recovery reads remain reachable
under current Guardian authority. This is not an exclusive Guardian lease and
must not hold SQL/auth locks across actor, provider or audit I/O.

Canonical actor commands check the expected generation and current stored
definition in the same realm transaction/read view as their operation. Parent
release checks use the admitted generation too, so queued old SSE/file/typing
payloads cannot be released because a cache invalidation hint was delayed.
Transport hints are wakeups, not authority; reconnect revalidates and obtains
a fresh authorized snapshot. Already released network bytes are not recallable.

The initiating policy writer uses a narrowly defined expected-old-generation
to accepted-new-generation transition tied to its exact durable command. Its
own accepted change must not invalidate its response merely because the
generation advanced. Still revalidate Guardian/session/scope/delegation at the
final boundary; unrelated policy changes and real revocation are not excused.
Return an admin acknowledgement/receipt, not a participant transcript fetch
which the manager might not be allowed to perform after the edit.

Define a distinct policy-invalidated/reconciliation error contract in the
SDK. Retire old private content when its admission generation is no longer
known to be valid, even if the underlying actor transport temporarily returns
503. Do not classify that as ordinary same-scope transient retention or reuse
`LOGGING_ADMISSION_REQUIRED` to hide it. A genuinely unchanged-policy transport
503 may retain the accepted page. Unknown mutation outcomes and admission
withdrawal are separate facts, and neither authorizes an automatic new mutation.

Guard both actor and target eligibility through existing Guardian revalidators.
Real role, session, tenant, trusted-property and policy revocation fences stay
intact. Avoid extending the auth fingerprint with unrelated editable settings.
Genuine accepted-write uncertainty remains unknown and cannot authorize replay.

Guardian changes schedule coalesced maintenance per affected retained scope.
Scan bounded candidate pages and yield outside leases; commit at most the
supported group's bounded membership set at once. One stale generation is
coalesced to the latest desired work, without concurrent duplicate scans of a
scope. A crash/restart resumes or recomputes from durable desired state. Never
evaluate the whole directory on every message, poll every tenant on a timer,
or make a private chat wait for unrelated tenant reconciliation.

Use existing Fabric actor capacity and independent per-database writer lanes.
No new global serialized queue is introduced. AI stays in the existing
concurrent Torrent pool, notifications in their existing durable path, and
logging delivery in its private workers. Reconciliation does no provider I/O.

## Audit and operational behavior

Record one human-readable semantic result at the canonical writer boundary:
settings changed, group created/renamed, membership rule changed, members
added/removed, group archived/restored. Identify initiator, current scope,
stable group reference, actual accepted revision and permitted change summary.
Use the existing source-transaction/outbox path when logging is configured.

Do not log message content, property values, preview member rosters, credentials
or raw settings JSON. Audit references may resolve identities only under the
investigator's existing authority. Rejected/rolled-back changes emit no false
success; a lost acknowledgment reconciles its original receipt without another
success record. Unchanged saves and ordinary live refreshes produce no writes
or change-audit events. Background reconciliation records actual membership
differences, not successful wakeups or one row per heartbeat.

Expose safe readiness and last reconciliation failure to authorized managers.
Do not treat an accepted definition as evidence of notification delivery or
provider success. Invalid configuration, actor failure, storage capacity and
required audit failure retain honest distinct outcomes and recovery paths.

## Delivery order and scope exclusions

1. Implement the immutable effective-policy and deployment-delegation boundary,
   migrations, canonical management service and revision/receipt protocol.
2. Qualify manual/automatic groups, previews and atomic membership changes;
   then wire the single management workspace and existing chat consumers.
3. Add delegated live settings with their distinct lifecycle semantics and
   retained-state transitions; expose locked support/AI setup accurately.
4. Complete browser, installed archive, bundled Linux and normal updater
   qualification before selecting a release. Follow the detailed acceptance plan.

No external Messenger/email adapter, new chat backend, nested reply-thread
system, group-invitation acceptance flow, group-bot membership, global transcript
moderation, arbitrary role creation, drag-and-drop rule programming language,
backup service or retention redesign is required for this feature.

## Related guides and next steps

- [Management experience](./messaging-administration-experience.md) defines the
  one-component layout, exact workflows, empty states and interaction ownership.
- [Implementation and qualification](./messaging-administration-qualification.md)
  defines dependencies, upgrades, three design reviews and release acceptance.
- [Current messaging configuration](../backend/messaging/configuration.md) is
  the implemented facade and group contract this design preserves.
- [Guardian control plane](../backend/guardian/control-plane.md) owns identity,
  role, property and scope semantics; this feature does not duplicate it.
- [Dynamic settings plan](./declarative-configuration-plan.md) supplies the
  broader defaults/delegation model without requiring that entire roadmap.
