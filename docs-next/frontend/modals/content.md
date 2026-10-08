---
id: zero.frontend.modals.content
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: content
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

# Content, Actions And Result Handles

[Modals index](./index.md) · [Documentation index](../../index.md)

The unreleased structured facade is `modals.show<T>(descriptor)`. It returns
`ModalHandle<T>`, unlike the compatible `modals.open({content})` string-ID API.
The manager builds the frame; the body supplies feature content only.

## Acknowledged Operation

This browser event fragment assumes a mounted host and a domain writer that
resolves only when the server has accepted the authorized operation:

~~~tsx
import { modals } from "@zero/framework/react";

async function renameProject(trigger: Element, saveName: () => Promise<string>) {
  const handle = modals.show<string>({
    title: "Rename project",
    trigger,
    body: <p>The new name will apply to this workspace.</p>,
    actions: [
      { id: "cancel", label: "Cancel", role: "cancel" },
      { id: "save", label: "Save changes", variant: "primary",
        onClick: async () => await saveName() },
    ],
  });
  const result = await handle.result;
  if (result.kind === "accepted") return result.value;
  return null;
}
~~~

Actions are admitted synchronously and single-flight per instance. While pending,
actions/navigation/close controls lock and body editing is inert by default.
A thrown/rejected action keeps the modal open with a safe generic footer error;
raw exception text is never rendered automatically. The app can use
`context.setError(safeMessage)` and return `false` for an expected correctable error.

An action's `false` return means “keep open,” not an accepted boolean result.
`closes:false` also keeps it open. A resolving action normally accepts its returned
value; if no value is returned, `action.value` is used, otherwise `true`.
Use `context.accept(value)` for explicit settlement, including an accepted false.

## Result And Handle Contract

| Handle member | Meaning |
| --- | --- |
| `id` | Exact admitted instance ID; never use “last modal” after awaited work |
| `result` | Promise settling once: accepted value, dismissed reason, or retired |
| `close(value)` | Accept this instance immediately; returns whether admission succeeded |
| `dismiss(reason?)` | Await advisory dismissal; may be refused by pending/required/dirty policy |
| `update(partialDescriptor)` | Replace presentation generation; preserve this result waiter and instance ID |

`ModalResult<T>` is `{kind:"accepted",value:T}`,
`{kind:"dismissed",reason}`, or `{kind:"retired"}`.
Logical acceptance happens before optional exit animation completes; do not wait
for the 975ms entrance before starting validation or a real operation.

## Body Context And Nested Pickers

A body can be a React node or `(context) => ReactNode`. Return a separate component
for hook-based editing; do not build a second modal frame.

~~~tsx
modals.show<string>({
  title: "Choose a destination",
  body: context => <DestinationPicker
    onChoose={destination => context.accept(destination)}
  />,
});
~~~

This fragment assumes an app-owned DestinationPicker. The context provides
`id`, generation-owned abort `signal`, `accept`, `requestClose`, `setError`,
`setBusy`, `setDirty`, `setActionDisabled` and `show`.
Use `context.show(childDescriptor)` to establish parent ownership: parent closing
dismisses descendants, and each child result still settles exactly once.

The abort signal retires UI ownership. It is advisory to transport; it does not
undo an operation already accepted by the server. Keep mutation IDs and
idempotency/reconciliation with the domain writer.

## Legacy Content

`modals.open({title,content,...})` still returns a string ID. Use
`modals.update(id,partialOptions)` and `modals.close(id)` for that exact legacy
instance. Opaque legacy content does not become a standardized header/body/footer
just because it is hosted by the new manager. Convert with the
[migration guide](./migration.md), rather than renaming the call.

## Related Guides And Next Steps

[Configuration](./configuration.md) covers descriptors/actions; [forms](./forms.md)
composes native submit and accepted baselines; [lifecycle](./lifecycle.md) explains
updates, callback fencing and exit cleanup; [scope](./scope-transitions.md) owns
authoritative retirement.
