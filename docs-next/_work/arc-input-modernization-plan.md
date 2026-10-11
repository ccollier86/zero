---
id: zero.arc-input-modernization-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: arc-input-modernization
maturity: planned
applies_to: ["2.6.0 dirty working source; documentation-only plan for TagInput, PhoneInput, MentionInput and InlineEditText; implementation not started by this plan"]
modes: [browser, SSR, controlled, native-form, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Arc Input Modernization Plan

[Working evidence](./index.md) · [Canonical UI reference](../frontend/ui-reference.md) · [Component organization plan](./frontend-component-organization-plan.md)

Document the next input-family work without claiming that it is implemented.
The requested direction is Arc's compact, animated treatment, composed through
Zero's component library and design tokens. Preserve current public behavior,
native form semantics, accepted writes and SDK authority while changing the
presentation. New APIs below are design requirements, not available package
exports or instructions for applications to start using them.

This pass is documentation only. It does not modify input implementations,
publish a package, add an authorized user-directory endpoint or remove the
original theme. Source organization and theme retirement remain separate gated
operations in the linked plans.

## Scope And Current Owners

| Family | Current Zero contract | Planned direction |
| --- | --- | --- |
| TagInput | [Controlled tags and suggestions](../frontend/components/primitives/tags-and-validation.md), implemented in [ui/tag-input.tsx](../../src/components/ui/tag-input.tsx). | Arc-like pills, wrapping, selection feedback and accessible suggestions; preserve existing controlled callbacks and admission rules. |
| PhoneInput | [Full PhoneInput manual](../frontend/components/phone-input.md), implemented by the [phone-input family](../../src/components/phone-input/index.ts). | Morphing country picker, flags and visible calling code, plus an optional selector; keep the existing complete metadata engine and native validity contract. |
| MentionInput | No dedicated public MentionInput was found in the reviewed component/client sources. Existing [Guardian SDK surfaces](../frontend/guardian/sdk-surfaces.md) own identity and presence. | New controlled text/token input and a bounded read-only adapter over an already-authorized candidate projection; no new session, directory or presence owner. |
| InlineEditText | [Inline-editing manual](../frontend/components/primitives/inline-editing.md), implemented in [ui/inline-edit-text.tsx](../../src/components/ui/inline-edit-text.tsx). | Arc-like text/input continuity and accepted-save feedback on the existing revision-aware editing state machine. |

Do not turn a visual refresh into four parallel input/controller systems. Reuse
the [Input/Label contract](../frontend/components/primitives/inputs.md#input-textarea-and-label),
[Popover](../frontend/components/overlays/popover.md),
[Command](../frontend/components/primitives/command.md),
[ScrollArea](../frontend/components/primitives/scroll-area.md), Badge and Avatar
where their public composition fits. Private family helpers are documented with
their parent, not advertised as independently supported application primitives.

## Reference Evidence And Limits

The official component descriptions and Markdown were read. Registry TypeScript
and styles were inspected for behavior and composition: TagInput was read in
full; PhoneInput, MentionInput and InlineEdit were examined in relevant source
sections rather than treated as fully audited implementations. No reference
code was vendored or executed by this planning pass.

| Official reference | Source evidence | What it informs |
| --- | --- | --- |
| [Tag Input](https://uiarc.dev/components/tag-input), [Markdown](https://uiarc.dev/components/tag-input/markdown) | [Registry source](https://uiarc.dev/r/tag-input.json): `registry/components/tag-input/tag-input.tsx` and CSS. | Pill entry/removal, picked-tag feedback, wrapping geometry and keyboard intent. |
| [Phone Input](https://uiarc.dev/components/phone-input), [Markdown](https://uiarc.dev/components/phone-input/markdown) | [Registry source](https://uiarc.dev/r/phone-input.json): `registry/components/phone-input/phone-input.tsx` and CSS. | Country-button/panel morphology, searchable rows, flags/code transitions and validation feedback. |
| [Mention Input](https://uiarc.dev/components/mention-input), [Markdown](https://uiarc.dev/components/mention-input/markdown) | [Registry source](https://uiarc.dev/r/mention-input.json): `registry/components/mention-input/mention-input.tsx` and CSS. | Native-textarea mirror, token/caret behavior and a caret-anchored suggestion panel. |
| [Inline Edit](https://uiarc.dev/components/inline-edit), [Markdown](https://uiarc.dev/components/inline-edit/markdown) | [Registry source](https://uiarc.dev/r/inline-edit.json): `registry/components/inline-edit/inline-edit.tsx` and CSS. | Text/input metric continuity, clicked-caret intent, size transitions and saved/error feedback. |
| Shared reference motion | [Arc motion tokens](https://uiarc.dev/r/arc-motion-tokens.json). | Duration, spring, blur and stagger vocabulary to compare with Zero's existing roles. |

Resolve provenance, attribution and applicable license requirements before
copying implementation material. A free component page alone does not establish
that the source-license review is complete. Prefer Zero-owned implementation
over blindly importing an upstream state machine with different guarantees.

The reference catalog is evidence, not a second token authority. Record any
missing family roles in the existing design-token work; do not introduce global
Arc variable names alongside Zero's canonical token composition.

## TagInput: Preserve Admission, Improve Interaction

The current [TagInput props](../../src/components/ui/tag-input.tsx) are `value`,
`onChange`, `placeholder`, `maxTags`, `allowDuplicates`, `delimiter`, `disabled`,
`className`, `tagClassName`, `suggestions` and `onSearch`. Keep these names and
their controlled-consumer meaning unless an explicit migration is approved.

### Contracts To Preserve

- The accepted tag list belongs to the controlled owner. Omitting `value`
  currently supplies an empty list; it does not establish uncontrolled tag
  storage. Only the text draft and suggestion visibility are locally owned.
- Trim candidates, ignore blanks, check duplicates against the growing batch
  and stop at capacity. A delimiter event emits one coherent replacement through
  `onChange`, not one callback per admitted tag.
- Duplicate exclusion is currently case-sensitive. `allowDuplicates` permits
  distinct occurrences, and removal is by occurrence/index, not by removing
  every tag with a matching label.
- Enter admits the draft; empty-draft Backspace currently removes the last tag
  immediately. A rejected batch does not falsely report an accepted addition.
- `onSearch` reports the draft to the caller; it does not own a transport,
  authorization policy or debounce. Later suggestion-prop updates remain usable
  after the original input event.

The existing [controlled delimiter browser tests](../../src/components/ui/tag-input.browser.test.ts)
are regression baselines, not proof that the proposed interaction is finished.

### Planned Presentation And Accessibility

The requested target includes Enter/comma admission (and the existing
configured delimiter), admission on blur, a case-insensitive duplicate feedback
pulse, Backspace at the start of the draft to pick the preceding tag before a
second deletion, Delete to remove a picked tag, Left/Right traversal and Escape
to clear the pick. Removal remains occurrence-aware when duplicates are
allowed. These are requirements of the requested Arc interaction, not merely
effects to evaluate. The migration must make the differences from today's
default explicit through a documented compatibility mode or versioned behavior
change, rather than silently break existing consumers.

Use the existing pill/Badge vocabulary with restrained entry/removal feedback
and stable layout-position transitions. Wrapping should grow the real control
without flashing a scrollbar or moving unrelated rows. Add meaningful remove
labels and concise live announcements for additions, removals, limits and
rejections. Keep decorative highlights out of the accessibility tree.

Suggestions need real combobox/listbox semantics, active-option identity,
Arrow/Home/End navigation, Enter selection and Escape dismissal. The magnetic
highlight follows that native active option; it does not become the selection
controller. Reuse the anchored surface and scroll treatment rather than retain
the current unbounded absolute `z-50` popup as a second overlay policy.

Guard all composition-sensitive admission/deletion paths before key handling.
Composition text and delimiters must not add or remove tags until composition
has ended. Paste and delimiter batches must apply the same atomic capacity and
duplicate rules. Preserve remaining/rejected draft content according to a
specified policy, not accidental event ordering.

Stable occurrence identities are required when duplicate tags are allowed;
label-only keys or label-based removal cannot represent that contract. External
controlled replacements must retire stale picked-tag and suggestion identities.
Qualification must include an owner that accepts, delays or rejects callbacks.

Any new read-only mode must retain readable/copyable tags while blocking draft
edits, removals and suggestion admission. Disabled and read-only changes retire
open suggestions and prevent late selection callbacks. Do not treat a disabled
visual input alone as a guard for every callback path. Native serialization,
focus behavior and reset need explicit decisions before adding a form facade.

### Behavior Decisions Before Implementation

| Arc behavior or missing capability | Required decision |
| --- | --- |
| Blur commits an unfinished draft. | Implement the requested target with an explicit compatibility/versioned migration contract; current Zero has no blur admission. |
| Duplicate matching ignores case and pulses the existing tag. | Implement that target without silently changing case-sensitive legacy admission. Specify behavior when `allowDuplicates` is enabled. |
| Backspace-at-start picks a tag; a later Backspace/Delete removes the pick. | Implement the requested traversal/picking target and document how existing one-step deletion consumers migrate; retain equivalent touch/removal controls. |
| Upstream starts with uncontrolled `defaultValue` support. | If adding uncontrolled tags, specify reset and controlled/uncontrolled boundaries; do not reinterpret today's omitted `value` silently. |
| Read-only, forwarded ref, labeling and native form integration are incomplete locally. | Define additions together, including submission representation and disabled/read-only differences; proposed option names are not settled here. |

## PhoneInput: Morph The Picker, Keep The Engine

The [reference contract](https://uiarc.dev/components/phone-input/markdown)
includes controlled country, preferred-country grouping, hidden labels, helper/
error copy and value-detail callbacks. Its keyboard model includes country-button
arrow/type-to-search opening, country-list paging and a calling-code search
shortcut from `+`. Record these capabilities and their interaction with normal
international typing before selecting Zero defaults. Current Zero has no
controlled-country or selector-visibility prop; existing `onChange` and real
validation must not be replaced by the reference's length-based details API.

Keep the current [typed contract](../../src/components/phone-input/phone-input.types.ts),
[control](../../src/components/phone-input/phone-input.tsx),
[country picker](../../src/components/phone-input/phone-input-country.tsx),
[native adapter](../../src/components/phone-input/phone-input-native.tsx),
[embedded flags](../../src/components/phone-input/phone-input-flag.tsx) and
[validation helpers](../../src/lib/phone-number.ts) as the baseline.

### Required Country And Value Behavior

- Omitting country configuration starts national input as `US` / `+1`. A
  prefilled international number still selects its inferred country; US is not
  a forced override, geolocation decision or browser-locale lookup.
- Preserve the complete supported country metadata and embedded SVG flags from
  the existing phone engine. The inspected Arc source has a 49-country table;
  importing that table would narrow existing support.
- Keep `countries`, labels and `onCountryChange`, including restriction and
  localized-name behavior. Search covers the displayed country, ISO code and
  calling code, including shared calling codes.
- Preserve international draft emission, including incomplete nonempty values
  and a lone `+`. Only an actual clear emits `''`; do not normalize an incomplete
  draft into a misleading empty value.
- Keep `possible`/`valid` numbering-plan validation through the existing
  libraries. Arc's handwritten formatting and length checks must not replace
  it. Formatting/validity never establish ownership, consent or reachability.

### Optional Selector And Native Forms

The requested country-selector switch and optional flag treatment are separate
new capabilities, not existing PhoneInput props. Choose their public names only
after specifying these cases: selector omitted/default-visible, explicitly
hidden, flags shown/hidden independently, read-only, disabled, restricted
countries and externally changed international value. A hidden selector must
still show an unambiguous calling-code interpretation without making an
editable number read-only or locking it to the wrong country. Static country
and `US` / `+1` presentation must remain understandable with flags off; text
and accessible country labels cannot rely on the flag alone.

Keep exactly one named canonical hidden field. The visible formatted input
remains the ref/focus/label/required/native-validity owner; it is not a second
named value. Preserve external `form` association and uncontrolled form reset.
Controlled owners remain responsible for resetting their accepted value.

`readOnly` remains focusable, selectable, copyable and submittable, with a static
country prefix; `disabled` blocks interaction and excludes the named field.
Changing either lock while the picker is open must close it and reject late
country callbacks. Caller-supplied `aria-invalid` remains authoritative over
the control's own after-blur presentation.

### Planned Picker Composition

The small flag/code trigger grows into the country menu and shrinks back;
selection changes use restrained flag/code/label transitions. Include preferred
country grouping only if configured and compatible with restrictions. Dividers,
headers, search, selected marks and trailing calling codes should use the
shared menu vocabulary. The active-row magnetic highlight follows Command's
actual keyboard/pointer state.

Keep one Popover/controller and one real scroll viewport. Existing Command and
ScrollArea composition must be inspected for scroll ownership before adding
edge fades or rails; a second wrapper cannot create a second scrollbar. Cover
collision handling, trigger resize, long translations, narrow viewports and
focus restoration through the existing overlay system.

No extra provider, phone-directory request, SMS flow or avatar/flag network
fallback is introduced by installing this input. Contact verification remains
the separate [Guardian contacts contract](../backend/guardian/contacts.md).

## MentionInput: New Facade, Existing Authority

The [reference API](https://uiarc.dev/components/mention-input/markdown) also
defines controlled/uncontrolled text-plus-token values, independently optional
people/channel lists, mention-add and opt-in submit callbacks, minimum/maximum
rows (1/8), suggestion cap (6), and auto/top/bottom placement. Its ref exposes
focus, insert-at-caret, open suggestions, clear and the textarea; serialization
can supply a custom token format. Preserve these capabilities in the proposed
Zero contract where appropriate, without claiming those reference prop/method
names are current Zero exports. Native form text and structured mention IDs
need the deliberate representation below.

Create a coherent family only after defining a controlled text/token model.
The Arc reference separates plain text from annotations identified by kind,
stable identity, label and range; that is a useful design starting point, not
a currently exported Zero type. People and channel candidates must come from
the caller's authorized projection or a read-only adapter over existing SDK
contracts. Local illustrative candidates remain a separate, explicitly labeled
demo use case.

### Text, Token And Caret Model

Use a real native textarea, with an accessibility-hidden mirror only for token
paint. Validate annotation ranges against native UTF-16 offsets: integer,
bounded, ordered and nonoverlapping, with text consistent with the displayed
token. Do not split surrogate pairs or grapheme boundaries during selection,
replacement or deletion. Identity is not inferred from a display label;
duplicate names remain distinct candidates.

Specify token insertion, selection replacement, caret restoration, left/right
navigation, whole-token deletion and annotations surviving edits before motion
work. Trigger scanning must respect the caret, delimiters, existing annotations
and maximum search extent rather than match every `@` or `#` in pasted prose.
Paste, drop, autofill, multiline edits and controlled external replacements
must reconcile ranges deterministically. Rendering uses safe text, never
untrusted candidate HTML.

Decide the native form representation deliberately: text alone cannot preserve
stable mention identities. Store or serialize text and tokens through a typed
application contract, then revalidate recipient permissions server-side. The
reference's serializer is evidence for that need, not permission to expose its
format as a settled Zero API.

Cover browser undo/redo and input-event behavior. The reference uses
`execCommand('insertText')` with a fallback; verify the chosen native insertion
strategy across supported browsers rather than promise that deprecated APIs
provide a universal undo contract.

### Suggestions, Composition And Layout

The panel anchors to the actual caret, flips/shifts near edges and follows
textarea scroll, resize, zoom and direction. It is not a full modal or an
automatic From Button animation. Reuse the appropriate anchored-surface,
magnetic-option and native-scroll roles without another global popup manager.
Provide combobox/listbox relationships and stable active-descendant IDs; normal
textarea text must remain readable once, not through both mirror and input.

Guard IME before suggestion selection, token deletion and Enter/Tab handling.
The reviewed upstream key handler checks composition late for submission, so
copying it verbatim would not meet this requirement. Escape dismisses options
without mutating accepted text. Specify Enter selection versus newline/submit,
Tab acceptance versus ordinary focus traversal, and a non-keyboard selection
path. Keep submission opt-in and prevent double submission.

Autosizing and a row cap must decorate the textarea's actual scroll viewport;
do not add a competing overflow container. Test layout with rich rows, avatar
placeholders, descriptions, empty/loading/error states and large candidate sets.

### Authorized User And Presence Adapter

| Existing source | Safe reuse and boundary |
| --- | --- |
| [Own-profile hooks](../../src/frontend/client/user-profile-hooks.ts) and [own-avatar hooks](../../src/frontend/client/user-avatar-hooks.ts) | Current-account settings/bytes, not a directory of arbitrary people. Do not turn them into background target-user lookup. |
| [Tenant member hooks](../../src/frontend/client/tenant-member-hooks.ts) | Active-tenant administration with capability checks. Reuse only for a caller that already has that entitlement; an ordinary mention box does not grant it. |
| [Application access hooks](../../src/frontend/client/application-administration-hooks.ts) | Existing application-administration user projection with its own server capability checks; not a universal member directory. |
| [Avatar directory transport](../../src/frontend/client/auth-user-avatar-transport.ts) | Policy-bound minimal display information for an already-known identity. It is not a bulk-search or account-enumeration API. |
| [Guardian presence hooks](../../src/frontend/client/guardian-presence-hooks.tsx) | Observe the existing SDK tracker and fresh `useAvatarPresence` projection. Do not start a second heartbeat, activity listener or status resolver. |
| [Room presence list](../../src/frontend/client/presence-list-hooks.ts) | Existing room observations. Custom names/labels are untrusted display metadata, not proof of membership or authorization. |
| [Authorization boundary](../../src/frontend/client/authorization-scope-hooks.ts) | Mask retired scope data and reject work captured under an old account/tenant/session/data revision. |

No ordinary-member searchable directory API was established by this research.
If the intended application needs one beyond its existing authorized roster,
that is a separately reviewed SDK/server capability gap, not a frontend fetch
shortcut. Do not probe administrative lists or guess target identities to fill
the menu.

Any asynchronous candidate adapter needs cancellation plus a generation/query
fence. Recheck the captured authorization boundary after every await; retire
stale results when query, record, account, tenant or policy context changes.
Clear retired candidate rows, active identity, presence and object URLs
immediately. The application decides whether a local text draft may survive a
record change; the component must not preserve another account's candidate cache.

Presence freshness is display state, not permission. Unsupported or stale
statuses remain unknown/off according to the existing capability catalog.
Private avatar delivery retains current policy and URL revocation rules.
Typing, selecting or hovering a mention does not send notifications or write
membership/profile/presence. Notification/trigger/function work follows a real
accepted application write and server-authorized recipient resolution.

Specify disabled/read-only behavior for the new facade: text remains selectable
where native semantics permit, but insertion, deletion, submit and suggestion
callbacks cannot mutate a locked value. Retire an open panel when locks change;
do not use dimmed appearance as the only safeguard.

The full authority contracts remain [Guardian SDK surfaces](../frontend/guardian/sdk-surfaces.md#own-profiles-contacts-avatars-and-presence),
[profiles](../backend/guardian/user-profiles.md),
[avatars](../backend/guardian/avatars.md#private-delivery-and-directory) and
[presence](../backend/guardian/presence.md).

## InlineEditText: Presentation On Accepted Writes

The [reference](https://uiarc.dev/components/inline-edit/markdown) additionally
offers validation, placeholder, title/body presentation, semantic span/paragraph/
heading hosts and multiline editing with Shift+Enter. Record those capabilities
when defining the refresh; they do not replace Zero's writer/revision contract
or become existing props simply by copying the reference's interface.

Keep `onCommit(value, { expectedRevision, signal })`, revision capture,
conflict/retry/reload handling and scope retirement. The current control offers
blur and explicit commit modes; changing visual presentation does not replace
them with an upstream unversioned `onSave` contract.

Retain the layout-preserving input overlay, row selection behavior, accessible
label and current single-line typography. Arc-like text/input continuity,
clicked-caret placement and accepted-value transition are presentation work.
Width changes while typing should settle without overshoot; font loading and
external resize should not animate from false geometry.

Save/check feedback occurs only after the existing commit resolves. Current
Zero sets its optimistic display after acknowledgment, not before the write.
Duplicate save events must remain synchronously locked. Preserve the distinct
failure policies: explicit mode keeps the original draft/editor on a commit
failure or revision conflict and supports retry/reload; blur mode restores the
latest controlled value and exits editing. A failed blur-mode commit may call
`onReload`; an observed revision change restores the latest value without that
save path. Do not imply that both modes preserve a failed draft. Avoid treating
post-acceptance navigation failures as rejected mutations.

Preserve Enter/Tab/Escape, IME guards, blur-versus-explicit semantics and
unmount/disabled/scope abort behavior. Tab movement waits for the accepted save
where that is today's contract. Late callbacks cannot focus, navigate or update
the new record/account. Do not use a record scope key as an authorization token.

Arc supports multiline and semantic text hosts; these are potential additions,
not existing InlineEditText props. Specify their native input, sizing, newline,
validation and row-height contracts separately before widening the facade.
Read the [complete inline-editing manual](../frontend/components/primitives/inline-editing.md)
before changing this state machine.

## Tokens, Motion And Protected Effects

Follow the [canonical UI reference](../frontend/ui-reference.md#which-motion-belongs-to-which-action),
[foundation](../frontend/design-system/foundation-next.md) and
[motion roles](../../src/design-system/theme-motion.ts). Compare Arc role usage
with existing Zero roles first; add narrowly scoped family aliases only where
there is a measured gap. No new palette, density or motion default is approved
just because a reference uses a different pixel value.

| Action | Mapping requirement |
| --- | --- |
| Country trigger expands/collapses | Existing picker/anchored-surface morphology, collision and focus ownership. |
| Keyboard/pointer option changes | Existing magnetic menu highlight follows the primitive's real active row. |
| Pills enter/remove; control wraps | Family-owned restrained pill/layout feedback with reduced-motion alternatives. |
| Mention options appear at caret | Anchored panel transition from caret geometry, not whole-page recede or a modal stack. |
| Inline draft becomes accepted text | Metric-preserving transition and acknowledged success/error feedback. |
| A menu/input really overflows | Shared Arc-like edge fades and overlay rail on the actual native viewport. |

Preserve polished sidebar/navbar magnetism, modal origin/Rise fallback,
dim/blur/recede/stack behavior, hold-to-confirm, Tooltip Grow/arrow and chart
inspector motion. This input project does not retune those families. Decorative
trigger buttons use visible keyboard focus without a persistent mouse-click
outline; text inputs retain their established focus affordance.

Record surface/background/border, muted/secondary text, typography roles,
control/pill/menu radius, compact spacing, avatar/flag sizing, selected marks,
validation tones and motion parameters in the existing token inventory. Compare
light/dark/high-contrast and scoped themes; avoid new component-private hex
palettes or a second typography scale.

## Source And Documentation Organization

Use the [source-organization rules](../frontend/components/source-organization.md).
Proposed homes are `controls/tags` for TagInput and its model/skin,
`controls/mention-input` for the new mention family, and the existing
`phone-input` family unless a separately qualified move is approved. Consider
an inline-editing family once its behavior and consumers are inventoried. These
are implementation-home proposals, not new supported package subpaths.

Retain the old `ui/tag-input` facade and public root/React imports when moving
it. Inventory its current Badge/utils dependency closure before defining frozen
copy companions; do not claim nonexistent old helper destinations. Preserve
context identity, stylesheet fan-in, ref/types and app-owned copied files.
Package/barrel/registry work needs an explicit public-surface review, not a
wildcard export of every model, fixture or private helper.

Give each new public facade a full family manual after implementation. Extract
TagInput/InlineEditText sections from their mixed primitive manuals only with
stable IDs/anchor compatibility and explicit links to the new canonical home.
PhoneInput's existing manual needs a current-source update, not a replacement
that loses native-form and schema-generated-form guidance. MentionInput must
document model invariants, composition, optional adapter authority and honest
backend prerequisites. The main UI reference and both assembly guides should
route to those manuals without duplicating exact prop tables.

## Delivery And Qualification Gates

This phase is documentation only. When following these documented contracts
in the implementation phase, work one family at a time. Record the current
exported symbols, controlled callbacks, native form values and copy closure
before changing that family's source. Keep compatibility changes separate from
new behavior decisions.

1. Resolve the TagInput behavior decisions, PhoneInput selector semantics and
   MentionInput candidate-authority gap. Set the exact new public types only
   after these contracts and their migration treatment are defined.
2. Build pure admission/range/caret helpers where needed, with deterministic
   tests. Keep formatting in the phone engine and authority in the SDK.
3. Compose existing primitives, one overlay owner and one viewport; then add
   token-mapped presentation. Avoid a combined rewrite of all four families.
4. Qualify controlled owners, SSR, native forms and real browser interaction.
   A source-only inspection or mocked picker is not visual/runtime acceptance.
5. Qualify public imports, source-copy closure, skipped existing customized
   files and upgrade detection. Doctor reports must distinguish supported old
   usage from actual required migration; do not autofix app-owned code blindly.
6. Update each full manual, canonical routing, token inventory and migration
   notes with actual evidence. Record what is verified versus still planned.

| Qualification area | Required cases |
| --- | --- |
| Tags | Single/batch delimiters, paste, blanks, legacy case-sensitive admission and target case-insensitive duplicate pulse, allowed duplicate occurrences, blur admission, pick/delete/traversal/Escape, limits, rejected/lagging controlled owner, late suggestions, IME and locks. |
| Phone | Every supported country/flag path, shared codes, omitted US/+1, inferred international values, restrictions/localized search, independently hidden selector/flags, national/international drafts, possible/valid, read-only/disabled changes and late country callbacks. |
| Mentions | People/channels, duplicate names with distinct IDs, UTF-16/graphemes, mid-text insert, replacement, deletion, copy/paste/drop, undo/redo, composition, asynchronous reorder/abort, external controlled replacement and safe malformed-token rejection. |
| Inline edits | Blur/explicit modes, Enter/Tab/Escape, IME, rapid duplicate events, accepted/rejected writes, changed revisions, reload errors, post-save navigation failure, disabling/unmount and record/auth retirement. |
| Authority | Not-ready SSR, login/logout/tenant changes, same-scope policy/data retirement, unauthorized directory attempts, stale presence, private avatar cleanup and no notification/write from local selection. |
| Layout and accessibility | Keyboard/touch/pointer, rich and empty menu rows, focus restoration, activedescendant/live notices, light/dark/scoped theme, RTL, zoom, long labels, font load, reduced motion, collision and actual single-viewport overflow. |
| Forms and package boundaries | Required/custom validity, exactly one canonical phone value, external form association/reset, defined tag/mention serialization, public facade imports, denied private/test paths and complete source-copy CSS/helper closure. |

No new input tests or browser/TypeScript qualification were run by this
documentation-only pass. Later implementation must attach its own evidence;
the existing tests and source contracts above are the baseline to preserve.

## Related Plans

- [Arc interaction follow-up](./arc-interaction-follow-up-plan.md) coordinates
  the requested input and other surface refinements without claiming they are
  implemented.
- [Arc scroll treatment across surfaces](./arc-scroll-surface-plan.md) owns
  expanded edge-fade/rail adoption and explicit specialized-viewport decisions.
- [Frontend component organization](./frontend-component-organization-plan.md)
  owns family moves, source-copy compatibility and documentation relocation.
- [Design-token/theme evolution](./design-token-theme-evolution-plan.md) and
  [typography](./typography-system-plan.md) own the shared language; this input
  plan does not create a second theme or typography scale.
