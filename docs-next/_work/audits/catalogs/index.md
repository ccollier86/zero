---
id: zero.inventory.catalogs
type: index
audience: [agent, maintainer]
owner: zero-documentation
status: in-review
visibility: internal
---

# Audit Catalogs

[Audit index](../index.md) · [Documentation index](../../../index.md)

These catalogs preserve coverage evidence. Symbol counts are discovery counts,
not counts of independent user features or supported deployments. Planned guide
paths remain plain text until those guides exist.

## Public And Frontend Coverage

- [Package exports](./package-exports.md): all concrete package paths and
  transitive export names, including unintended test wildcard routes.
- [Components](./frontend-components.md): each named public UI/provider/gate/icon.
- [Hooks](./frontend-hooks.md): each named public hook.
- [SDK members](./frontend-sdk-members.md): public service methods/properties.
- [Frontend support exports](./frontend-support.md): helpers, errors and facades.
- [Internal frontend bindings](./frontend-internal-bindings.md): source exports
  without an established public package route; not ordinary application APIs.
- [Source ownership and runtime activation](./source-ownership.md): every source
  directory, managed service composition, CLI and independent repository boundary.
- [Configuration fields](./configuration-fields.md): 608 field/evidence rows for
  the principal startup/config hierarchies, classified by public boundary and
  owner. This is not an assertion that every runtime default was tested.

The package export JSON is a machine-readable audit artifact linked from its
Markdown catalog, not a new runtime discovery API.

## Reconciliation In Progress

Detailed guide writing follows inventory review;
finding a file or an exported name does not establish its behavior or maturity.
