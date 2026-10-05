---
id: zero.frontend.app-shell.workspaces
type: how-to
audience: [developer, agent]
owner: frontend-app-shell
status: draft
visibility: internal
system: frontend-components
feature: app-shell-workspace-selection
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

# Workspace Selection Without Scope Confusion

[AppShell index](./index.md) · [Documentation index](../../index.md)

workspaces is an AppShellWorkspaceConfig. Each item requires id and name, with
optional subtitle, icon, logo and shortcut. The shell displays and reports a
selection; a Guardian-aware data source must actually commit the active tenant,
wait for provisioning/readiness, and replace the authorization-bound data scope.

activeId selects a matching item. By default a missing/unknown activeId displays
the first item for legacy presentation. Set requireActiveSelection=true when the
label must represent a committed authority-owned workspace: an unknown ID then
shows 'No active workspace' instead of implying that the first item is active.

```tsx
import { AppShell } from '@zero/framework/components/app-shell';
import type { AppShellWorkspace } from '@zero/framework/components/app-shell';

type WorkspaceFrameProps = {
  items: AppShellWorkspace[];
  committedId?: string;
  pending: boolean;
  error?: string;
  requestSelection(workspace: AppShellWorkspace): void;
  children: React.ReactNode;
};

export function WorkspaceFrame(props: WorkspaceFrameProps) {
  return (
    <AppShell workspaces={{
      items: props.items,
      activeId: props.committedId,
      requireActiveSelection: true,
      pending: props.pending,
      error: props.error,
      onSelect: props.requestSelection,
    }}>
      {props.children}
    </AppShell>
  );
}
```

This is an integration fragment, not a replacement tenant-switch API. Prefer the
[Guardian organization sources](../guardian/index.md) for live authority. Do not
optimistically label organization B while queries still use organization A.

## Pending, Error And Accessibility Contract

pending freezes selection, create, retry and activeActions, while keeping the
committed item visible. The trigger reports aria-busy/aria-disabled and prevents
pending mouse/pointer/activation-key interaction. pendingLabel defaults to
'Updating workspaces…'. error renders both menu text and an accessible alert;
onRetry adds retryLabel, default 'Retry workspace list'. Error alone does not
freeze actions; pending is the interaction fence.

announcement supplies polite completion text. Increment a truthy focusRevision
to request focus restoration on the trigger in the next animation frame, when
it remains connected. These are presentation signals supplied by the data source;
they do not persist messages or retry automatically.

label defaults to 'Workspaces'; createLabel defaults to 'Add workspace'. onCreate
adds the create action. activeActions supplies the same menu-item union as other
shell menus. Item shortcuts default to displayed Command-number labels; the shell
does not register corresponding keyboard shortcuts.

If no active item, create action, required selection, pending state or error
exists, the header falls back to the brand control. Empty required selections
remain visible and show an empty list rather than a fabricated selection.

## Related Guides And Next Steps

- [Guardian organization control planes](../guardian/index.md) owns membership,
  switching and role visibility.
- [Runtime scope transitions](../runtime/index.md) prevents stale UI/data admission.
- [Fabric provisioning](../../backend/fabric/index.md) owns database readiness.
