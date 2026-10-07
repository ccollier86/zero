---
id: zero.frontend.components.roadmap
type: roadmap
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: component-roadmap
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Reusable Component Roadmap

[Component index](./index.md) · [Frontend index](../index.md) · [Documentation index](../../index.md)

The current platform already contains full data, auth, storage, workflow and UI
systems. Future work should improve or compose those contracts, not describe
existing capabilities as absent foundations. These known user directions are
ideas/plans, not newly implemented component exports:

- [ ] Rich document reader/editor plugins, including nondisruptive autosave with
  explicit accepted persistence rather than merely a local debounce timer.
- [ ] A reusable general code editor with syntax highlighting, token-aware themes
  and bounded text editing. [JsonEditor](./json-editor.md) currently covers
  structured JSON and plain JSON text; this later work must use an approved
  existing editor rather than a homemade highlighting primitive.
- [ ] A richer AI prompt/chat interface that reuses the existing gateway, typed
  tools, streaming presentation, storage and tenant authority.
- [ ] Public website/content polish and a Markdown-first documentation plugin.
- [ ] Full blogging/calendar/file-browser experiences where real app requirements
  justify a reusable plugin rather than app-specific screens.
- [ ] Additional compact application/organization administration blocks and
  optional in-table mini-graphs with accessible exact data.
- [ ] Connect first-class editable profiles, avatar staging/cropping, verified
  contacts, regional preferences and required-completion policy to the adaptive
  user-settings experience, with safe post-bootstrap feature provisioning.
- [ ] First-class Guardian presence with multi-device leases, inactivity and
  admitted Reactive DB/Fabric projections. The working-source
  [avatar group](./avatar-group.md) supplies opt-in visual decoration, not this
  service; [settings matrix](./settings-matrix.md) and
  [integration list](./integration-settings-list.md) supply controlled settings
  compositions without inventing persistence or provider management.
- [ ] Review the user's additional component references and expand the library
  with coherent token-themed controls, accessibility and SSR support; use those
  additions to refine the default visual language rather than introduce unrelated
  component-specific palettes.
- [ ] Design independently installable UI and icon packages. Keep existing
  `@zero/framework` React/component/icon imports as compatibility re-exports where
  practical; map shared hooks, tokens, CSS scanning, peer dependencies and package
  versioning before changing distribution. This release does not split packages.

Follow the narrower [primitive roadmap](./primitives/roadmap.md),
[overlay roadmap](./overlays/roadmap.md), [public-page roadmap](./public-pages/roadmap.md),
[text roadmap](./text/roadmap.md), [AppShell roadmap](../app-shell/roadmap.md)
and [design-system roadmap](../design-system/roadmap.md) for the relevant owner.
The modal-manager redesign remains with [modals](../modals/roadmap.md), not a
second conflicting global manager in this umbrella.

Confirmed defects are corrected and tested during the audit rather than deferred
as product limitations. Remaining whole-device, assistive-technology,
installed-package and representative-app qualification gates are evidence work,
not proof that those future features have been implemented.

## Related Guides And Next Steps

- [Component index](./index.md) locates the current reusable families.
- [Configuration](./configuration.md) links the existing typed settings.
- [Guardian interfaces](../guardian/index.md) owns authority-aware control-plane evolution.
