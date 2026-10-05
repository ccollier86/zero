---
id: zero.frontend.overlays.collapsible
type: reference
audience: [developer, agent, operator]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: collapsible
maturity: supported
applies_to: ["2.1.1 source with audited interaction/token corrections; publication qualification pending"]
modes: ["React browser UI", "SSR composition", "controlled or local interaction state"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Controlled Disclosure And Retained Content

[Overlays index](./index.md) · [Documentation index](../../../index.md)

Root/react and /components/collapsible export Collapsible, CollapsibleTrigger,
CollapsibleContent and useCollapsible, plus Props and CollapsibleContextType.

Complete controlled disclosure:

```tsx
import { useState } from "react";
import { Button, Collapsible, CollapsibleTrigger,
  CollapsibleContent } from "@zero/framework/react";

export function DetailsDisclosure() {
  const [open, setOpen] = useState(false);
  return <Collapsible open={open} onOpenChange={setOpen}>
    <CollapsibleTrigger asChild><Button variant="outline">Details</Button></CollapsibleTrigger>
    <CollapsibleContent><p>Additional information.</p></CollapsibleContent>
  </Collapsible>;
}
```

Root supports controlled or defaultOpen/local state. useCollapsible must be
called inside the root and returns isOpen/setIsOpen; outside context is a render
error. Trigger may delegate to a suitable asChild element.

## Rendering Policy

Content defaults keepRendered=false. Closed content exits and unmounts through
AnimatePresence; reopening creates its local subtree again.
keepRendered=true keeps the mounted content while height/opacity animate closed,
preserving child state but not making it a public authorization gate.
Default transition duration0.35s/easeInOut.

Animated content owns Motion/Radix composition. It intentionally omits the
ordinary forceMount/asChild options; use keepRendered rather than reaching into
private primitives. Forwarded className/Motion props control presentation.

Data inside a disclosure still needs normal permission/scoping.
Collapse does not cancel an already started network mutation, erase sensitive
cache or authorize visibility. Keep interactive/focus behavior appropriate when
retained content is closed; verify the actual composed subtree.

[Sidebar menus](./sidebar-menu.md) combine disclosure with nested navigation;
[configuration](./configuration.md) owns prop defaults and
[modals](../../modals/index.md) own overlays/confirmation rather than disclosure.
