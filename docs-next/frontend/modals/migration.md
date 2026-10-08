---
id: zero.frontend.modals.migration
type: how-to
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: migration
maturity: supported
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, standalone, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Migrate Existing Dialogs Without Breaking Ownership

[Modals index](./index.md) · [Documentation index](../../index.md)

Adopt the unreleased structured shell deliberately. Legacy `modals.open` remains
compatible; an upgrade does not silently change its string-ID return type or
rewrite application content. Inspect the actual installed version before using
new facade symbols.

## Map The Existing Contract

| Existing pattern | Structured replacement |
| --- | --- |
| open({content}) → string | show({body,title,actions}) → ModalHandle<T> |
| App-built header/X/footer inside content | Remove the copied frame; provide title/description/meta/icon/footer/actions |
| close(id) after async work | Return an acknowledged action value or context.accept(value), fenced to this instance |
| showCloseButton:false | dismissible:false for a genuinely required structured step |
| from flip direction | motion.entrance preset; origin requires explicit trigger |
| custom per-dialog Escape/global z-index | Existing owned host/floating components |
| legacy void form handleSubmit used as success | useModalForm over typed submit()/accepted save controller |
| separate confirmation frame | Existing confirm/actionConfirm/alert or ConfirmProvider adapter |

Do not cast a string into a handle or read private modalStore/_resolve fields.
Do not remove the old frame before supplying a required visible title. Preserve
server validation, permission checks, operation identity and writer acknowledgment.

## Convert One Modal At A Time

1. Identify whether the dialog is a decision, actual acknowledged mutation,
   native form, retained settings layout, picker or durable progress view.
2. Move title/meta/description/icon/close ownership into the descriptor; body now
   contains only feature content. Match layout to content/tabs/nav.
3. Move footer helpers/actions into the descriptor. Provide native formId for
   ambiguous form targets; no global Enter shortcut should guess the writer.
4. Replace `open` return-value usage with exact handle.result/close/dismiss semantics.
   Distinguish accepted/dismissed/retired; old close notifications are not receipts.
5. Supply the initiating trigger when appropriate. Origin fallback is Rise;
   default duration multiplier 1.5 is deliberately longer, not faster.
6. Bind existing form dirty/save/leave state and reactive record readiness
   rather than introducing a second subscription or optimistic “success” flag.
7. Preserve parent ownership with context.show and use existing Zero floating
   controls inside dialogs.
8. Verify the modal's actual interaction risk, then remove obsolete app-frame CSS.

For React-controlled state, ControlledModal adapts open/onOpenChange plus a
structured descriptor without replacing callback ownership on every keystroke.
Its identityKey must change when the target/frame changes. Setting open=false,
changing identityKey or unmounting is owner-driven retirement, not a user leave
request; use the manager's normal dismissal path for advisory guards. Body and
callbacks remain live within one owned opening; structural presentation is
snapshotted. Do not expect changing arbitrary descriptor structure mid-opening
to behave like updating the handle.

Title/meta/description/icon/tone/footer and action presentation stay live through
the adapter without retiring its callback generation. Body callbacks also stay
live. Keep action IDs stable; geometry, panel structure, target and guard changes
still require a deliberate new identity/opening.

ConfirmProvider/useConfirm now adapts its single-slot boolean contract to the
same manager. Replaced/unmounted requests still settle false. It supplies a
fallback host only when none exists, not a second stack under AppProvider.

## Deliberate Command-Palette Compatibility

CommandDialog is a separately audited special composition: hidden accessible
title/description, search input and cmdk result list, not an ordinary form frame.
Do not mechanically force it into the standard visible-header/footer anatomy.
It retains its documented controlled open/focus/filter and transition contracts;
see [Command palettes](../components/primitives/command.md). Review its own
layer/focus behavior when composing it with a managed dialog. A direct-primitive
Doctor finding here is a manual-review signal, not proof it should be rewritten.

When opened inside a managed ownership context, its floating branch inherits
that owner's container, live theme and overlay/content layer slots. The scoped
palette keeps its specialized keyboard behavior: Escape consumes the child
dismissal instead of also closing the containing modal.

## Source-Only Doctor Review

~~~sh
zero doctor --source-only --project-root . --usage-include app --usage-include components --json
~~~

This path skips app config discovery/imports, resources/plugins and DB inspection.
For a fully deliberate initial Bun environment, see the
[no-env launch guidance](../../cli/doctor/source-audit.md#source-only-command-and-api).
Installed export metadata and reachable facade source inform migration advice;
missing/older/unknown packages do not magically gain show support.

AST findings provide file/line, required/recommended/manual-review category and
confidence. They recognize literal imports/aliases/namespaces, multiline calls,
known missing titles, invalid literal options/motion, private imports, manual
frames and unsafe native nesting. Unknown wrappers/spreads are review items,
not proof of a broken layout. Scoped exceptions remain available for deliberate
managed-custom integrations.

Doctor performs no source rewrites and cannot certify clipping, focus, scrolling
or visual polish. A clean static report is not migration completion.

## Qualification Checklist

- Header/X/footer do not overlap body; long content scrolls only in its body.
- Narrow/mobile/fullscreen/custom dimensions stay within the viewport.
- Form validation/IME/textarea/popup Enter does not invoke an unintended writer.
- Repeated action clicks are single-flight; safe errors keep drafts usable.
- Parent/child/popups consume Escape once and restore focus to the current owner.
- Motion uses the exact defaults/overrides and live reduced preference.
- Dirty/changed-elsewhere/failed/unknown-outcome flows preserve drafts.
- Account/org/scope retirement settles without old action or focus callbacks.
- Source-only findings, public imports/types and documentation are aligned.

## Related Guides And Next Steps

[Layouts](./layouts.md), [configuration](./configuration.md), [forms](./forms.md),
[motion](./motion.md) and [Doctor source review](../../cli/doctor/source-audit.md)
provide the focused contracts needed for each migration.
