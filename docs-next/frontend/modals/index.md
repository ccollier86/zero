---
id: zero.frontend.modals.index
type: index
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: index
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

# Managed Modals And Deliberate Decisions

[Frontend index](../index.md) · [Documentation index](../../index.md)

Zero's modal system supplies a consistent frame and one lifecycle for forms,
settings, pickers, confirmations and workflow progress. Feature code provides a
title, content and actions; the manager owns the header, small close glyph, body
scrolling, footer, viewport placement, layers, focus and motion.

This section describes the **unreleased structured-modal upgrade** on the
2.6.0 source baseline. Check your installed package before adopting new symbols;
the [migration guide](./migration.md) preserves the legacy string-ID API.

## Start With A Structured Dialog

Normal AppProvider composition supplies the host and theme. Open from a browser
event, not during SSR:

~~~tsx
import { Button, modals } from "@zero/framework/react";

export function OpenDetails() {
  return <Button onClick={event => {
    modals.show({
      title: "Review handoff",
      description: "Check the details before continuing.",
      trigger: event.currentTarget,
      body: <p>The handoff is ready for review.</p>,
      actions: [{ id: "done", label: "Done", variant: "primary", value: true }],
    });
  }}>Review handoff</Button>;
}
~~~

Supply the actual initiating control through `trigger`. The default entrance
grows from that usable control; a programmatic open or unavailable control uses
Rise. Do not wrap the body in another Dialog or add a duplicate header/close button.

## Choose A Guide

- [Host and composition](./modal-manager.md): install one host and preserve portal/recession ownership.
- [Content and results](./content.md): descriptors, handles, acknowledged actions and nested pickers.
- [Layouts](./layouts.md): anchored anatomy, tabs, grouped navigation, long content, side placement and sizing.
- [Configuration reference](./configuration.md): exact public options, defaults and precedence.
- [Motion](./motion.md): six presets, approved defaults, exact timings, theme tokens and reduced motion.
- [Forms and reactive records](./forms.md): save acknowledgment, Save/Discard/Stay, record changes and revision boundaries.
- [Workflow progress](./workflow-progress.md): observe durable runs, readiness and explicit cancellation.
- [Confirmation](./confirm.md): decision-only versus action-backed confirms, alerts and deliberate holds.
- [Prompt](./prompt.md): a labeled single-field draft with sync/async validation.
- [Lifecycle](./lifecycle.md): exact ownership, parent/child settlement, updates and exit cleanup.
- [Scope transitions](./scope-transitions.md): old-scope retirement without stale callbacks.
- [HoldButton](./hold-button.md): sustained pointer/keyboard interaction and safety timing.
- [Migration](./migration.md): convert legacy dialogs and use Doctor's source-only review.
- [Managed drawers](../drawers/index.md): contained nonmodal inspectors and responsive modal sheets sharing this host and its guards.
- [Roadmap](./roadmap.md): implementation sequencing and remaining qualification, not a released API guarantee.

## Boundaries

Modals are presentation, not a transport, database, permission system or durable
workflow engine. Use the existing SDK/domain writers, form controllers, Guardian
scope boundary and Torrent hooks. Closing a progress view does not cancel its run;
a confirmation or browser abort does not prove a server write was rolled back.

For reusable settings rows, use [DenseList](../components/dense-list.md) with
optional avatars/icons and separate trailing controls. Do not put a Select/Switch
inside a surrounding native button.
