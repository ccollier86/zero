---
id: zero.torrent.frontend.index
type: index
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: frontend.index
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Torrent Frontend Hooks And Visualization

[Frontend systems](../index.md) · [Torrent backend](../../backend/torrent/index.md) · [Documentation index](../../index.md)

Zero supplies five workflow hooks for authenticated actions, live progress and
immutable safe topology. The server executes workflows; a browser tab is not
their process owner.

- [Hooks](./hooks.md): complete actions/results, selected run and progress groups.
- [Visualization](./visualization.md): topology paths, branches/items and safe UI.
- [Backend configuration](../../backend/torrent/configuration.md) sets up the
  server registry and recovered service.
- [Authority](../../backend/torrent/authority.md) owns security, not hidden UI.

Use @zero/framework/react (or the browser-safe root package) under the normal
AppProvider/client/Sync context. Do not mount another raw workflow socket or
import server-only registries/provider credentials into a browser bundle.

These primitives support an app-owned monitor/editor; they are not a packaged
n8n-style designer or an endpoint exposing private workflow payloads.
Source-backed examples remain drafts pending artifact qualification.
