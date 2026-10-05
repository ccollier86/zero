---
id: zero.frontend.hooks
type: index
audience: [developer, agent]
owner: frontend-hooks
status: draft
visibility: internal
---

# Generic UI Hooks

[Frontend index](../index.md) · [Documentation index](../../index.md)

Generic hooks own browser interaction/local state, not authenticated transport or
database persistence. Integrated SDK/domain hooks have their own guides.

- [Confirmation](./confirmation.md) documents the separate single-dialog provider
  and safely settled user-intent promises.
- [State and actions](./state-and-actions.md) covers accepted local commands,
  controlled/disclosure state and render/DOM state helpers.
- [Timing](./timing.md) covers debounce/throttle/timers and UI inactivity.
- [Browser interactions](./browser-interactions.md) covers refs/keyboard/clipboard,
  responsive/platform signals and Motion measurement.
- [Configuration](./configuration.md) identifies render-time arguments/providers.
- [Roadmap](./roadmap.md) distinguishes future UI convenience tooling.

These families give each inventoried generic hook a first-draft home. Detailed
source/example/browser/artifact review remains separate from page placement.

## Related Guides And Next Steps

- [SDK hooks](../sdk/index.md) owns scoped server data and transport.
- [Forms](../forms/index.md) owns schema-backed final submission.
- [Modal stack](../modals/index.md) owns the distinct imperative host.
