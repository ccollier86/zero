---
id: zero.concepts
type: index
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
---

# Shared Concepts

[Documentation index](../index.md)

Use these explanations to choose the right Zero building blocks before opening
an API reference. They describe responsibilities and boundaries shared by several
systems; feature pages own the exact options and operation contracts.

- [Data planes](./data-planes.md): system authority, application data, Fabric
  tenant data and storage/index sidecars.
- [Service and authority boundaries](./service-boundaries.md): setup, request and
  background execution; identity is not the same as an allowed action.
- [Reactivity](./reactivity.md): how committed database changes reach subscribed
  application state and rendered UI.
