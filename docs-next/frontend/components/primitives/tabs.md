---
id: zero.frontend.components.primitives.tabs
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: tabs
maturity: supported
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Controlled Tab Panels

[Primitive index](./index.md) · [Documentation index](../../../index.md)

The unreleased public facade exposes Tabs, TabsList, TabsTrigger, TabsContents
and TabsContent from root/React or @zero/framework/components/ui/tabs. It reuses
Zero's existing animated Radix tab components; it is not another modal manager.

Complete local composition:

~~~tsx
import { Tabs, TabsList, TabsTrigger, TabsContents, TabsContent } from '@zero/framework/react';

export function DetailTabs() {
  return <Tabs defaultValue="summary">
    <TabsList aria-label="Details">
      <TabsTrigger value="summary">Summary</TabsTrigger>
      <TabsTrigger value="activity">Activity</TabsTrigger>
    </TabsList>
    <TabsContents>
      <TabsContent value="summary"><p>Summary content.</p></TabsContent>
      <TabsContent value="activity"><p>Activity content.</p></TabsContent>
    </TabsContents>
  </Tabs>;
}
~~~

## Public Contract

Tabs follows the underlying root props: value/onValueChange for controlled
selection, defaultValue for initialization, orientation, activationMode,
direction and normal DOM props. Each trigger/content needs the same stable
nonempty value; label the tablist, and keep a visible trigger for each panel.
Trigger disabled and native Radix tab keyboard behavior remain available.

TabsContents defaults to auto-height and also accepts mode:'layout'. It wraps
content-size presentation, not application persistence or record readiness.
TabsContent supports the underlying forceMount option plus motion div props and
transition. Normal panels need not remain mounted; deliberate forceMount callers
must ensure inactive content is not incorrectly visible or interactive.

These primitives retain their existing animated highlight/content defaults and
explicit transition props. They do not inherit a ModalMotionOptions profile.
Inside an ordinary modal, use the manager's layout:'tabs' or layout:'nav' with
sections instead: that owns fixed frame height, retained visited drafts,
per-panel scroll and the tuned modal motion. Do not build a second modal header
using this tab family.

## Related Guides And Next Steps

- [Managed modal layouts](../../modals/layouts.md) standardizes dialog tabs/navigation.
- [Forms](../../forms/index.md) owns drafts and submission, not tab selection.
- [Component conventions](../../design-system/component-conventions.md) owns application-wide presentation guidance.
