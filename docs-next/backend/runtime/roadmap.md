---
id: zero.runtime.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: roadmap
maturity: planned
applies_to: [future proposals]
---

# Runtime Roadmap

[Runtime index](./index.md) · [Documentation index](../../index.md)

These product directions are separate from today's configuration/options:

- [ ] Design a dedicated server-only starter/profile with headless operator
  onboarding and deliberate single-tenant permission choices. This does not
  establish a current serverOnly option or a built-in environment HMAC service key.
- [ ] Improve reusable plugin-authoring ergonomics across server and frontend,
  while retaining explicit dependency/lifecycle/authority boundaries.
- [ ] Improve organization of configuration modules and agent discovery without
  introducing an undocumented merge/precedence graph or untrusted dynamic imports.

Source/runtime correctness findings are being fixed separately; they do not
become roadmap items or accepted limitations. A proposed deployment-management
product is a separate product idea, not another mode of createApp.

## Related Guides And Next Steps

- [Composition](./composition.md) describes the current app entry point.
- [Plugins](./plugins.md) describes today's extension seam.
- [Configuration](./configuration.md) is the current option contract.
