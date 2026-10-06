---
id: zero.plugins
type: index
audience: [developer, agent, operator]
owner: plugins
status: draft
visibility: internal
---

# Optional Zero Plugins

[Documentation index](../index.md)

Optional packages add a capability only when an application installs and declares
it. Zero's runtime and service boundaries remain the foundation; plugins do not
need a second authentication, database or UI framework.

## Plugin Guides

- [Markdown documentation](./docs/index.md): a folder-driven, read-only docs
  reader with navigation, search, syntax-highlighted examples and safe publication.

Each plugin has an overview/index, configuration reference, focused feature
guides and a roadmap. A plugin's package/version is distinct from the framework
release. Read its prerequisites rather than assuming all combinations work.

## How Plugins Integrate

The native server declaration is the existing `defineZeroPlugin` contract.
Optional declared build contributions compile public enhancements and private
content before runtime setup. Runtime setup consumes the resolved artifacts and
uses the app's service/observability/lifecycle boundaries.

Use [runtime composition](../backend/runtime/index.md) for server ownership and
[design-system conventions](../frontend/design-system/component-conventions.md)
for reusable UI. Installing a package alone must not start services, expose
routes or change application configuration.

This section is an isolated documentation draft. It does not publish itself,
replace the current docs or imply that a registry release is available.
