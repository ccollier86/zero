---
id: zero.frontend.modals.modal-manager
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: modal-manager
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

# Host Ownership And Application Composition

[Modals index](./index.md) · [Documentation index](../../index.md)

Mount one modal host for the application. Normal [AppProvider](../runtime/app-provider.md)
composition supplies it; a standalone browser UI can mount ModalManager directly.
This guide describes the unreleased structured-modal host, not an extra modal
service for every page.

~~~tsx
import { ModalManager } from "@zero/framework/modals";
import "@zero/framework/styles.css";

export function StandaloneUi() {
  return <ModalManager motion={{ durationMultiplier: 1.5 }}>
    <Application />
  </ModalManager>;
}
~~~

Application is an app-owned component in this composition fragment. Do not open
modals from SSR/server services or treat the process-global UI store as request-local.
Without a mounted host, an opened dialog cannot provide its normal interactive
lifecycle.

## Frame And Scene Ownership

The manager owns accessible naming, the fixed header/footer, small X glyph,
viewport sizing, active body scroll, one shared dim/blur backdrop, the page
recession surface, background scroll protection and focus handoff. Radix owns
dialog semantics and focus/dismissal mechanics; the platform does not ship a
second handwritten focus trap.

Page recession applies to a dedicated application-content wrapper, never blindly
to body or a portal host. Modal/floating roots remain outside that surface. Original
surface/body styles are restored after owned visual cleanup; rapid reopen cannot
let an obsolete completion clear a new scene reservation.

An optional portalContainer must be an app-owned, non-transformed HTMLElement
in the same browser document as the host and outside that recession surface.
Cross-document/iframe containers are rejected. This option does not provide
iframe rendering or ShadowRoot styling support. Preserve this boundary rather
than portaling into an arbitrary transformed feature wrapper.

Nested ModalManager mounts inherit the existing host. A standalone ConfirmProvider
or controlled dialog can provide a fallback host; under AppProvider they share its
stack instead of duplicating global dialogs.

Prefer a persistent AppProvider/ModalManager around feature lifetimes. If an owning
sibling host unmounts, its captured openings are authoritatively retired before
another host can claim presentation. Live forms/writers are not silently remounted
under a new renderer; their results retire and obsolete callbacks remain fenced.

## Stacking And Floating Children

Only the active top dialog accepts ordinary dismissal. Lower dialogs stay mounted
but are inert and recede visually. `context.show` establishes explicit parent
ownership; an unrelated modal is not implicitly a child just because it appears later.

Use Zero's existing controls inside modal content. The owned Select/Popover
and menu branches retain the originating modal's layer/theme
context. A child popup's Escape must close that popup, not the containing dialog
as well. Avoid ad-hoc global Escape listeners or unrelated z-index constants.
Special overlays such as CommandDialog are audited on their own composition
contracts; [migration](./migration.md#deliberate-command-palette-compatibility)
explains why they are not blindly converted to an ordinary form frame.

The close glyph is 14px with a 32px interaction target by default. Mouse activation
does not leave a persistent decorative ring; keyboard focus remains visible.
Required-step dialogs hide it through `dismissible:false`, not caller-built
replacement close controls.

The fixed layer follows VisualViewport offsets and available dimensions where
supported, so browser zoom or an on-screen keyboard can reduce the usable frame.
Theme tokens are copied from the initiating surface and follow its live
class/style and public-lane attribute changes, including scoped public and dark
lanes, through owned portals. Changing the public lane does not require a simultaneous
light/dark class change.

## Customization And Qualification

Use descriptor sizing/placement/layout/scrollbar options before className-based
changes. Body components may be fully custom while the host still owns the frame.
Portals and fixed children must preserve owned overlay boundaries; custom DOM
cannot be assumed equivalent just because it has role=dialog.

Store/controller unit tests and static SSR markup tests are separate from browser
qualification. Test scrolling, keyboard/focus, stacked popups, clipping, small
viewports and reduced motion when integration changes those responsibilities.
Do not report a clean Doctor scan as a visual or accessibility certification.

## Related Guides And Next Steps

[Configuration](./configuration.md) owns public props; [layouts](./layouts.md)
covers sizing/scroll chains; [lifecycle](./lifecycle.md) covers results/cleanup;
[scope transitions](./scope-transitions.md) fences authorization replacement.
