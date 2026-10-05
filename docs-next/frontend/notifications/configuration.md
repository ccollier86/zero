---
id: zero.frontend.notifications.configuration
type: reference
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: frontend-configuration
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [guardian-enabled, single-tenant, multi-tenant]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Notification Frontend Configuration

[Notifications frontend index](./index.md) · [Documentation index](../../index.md)

The backend feature follows Guardian-enabled composition; the browser cannot
enable it by rendering a bell. Use the existing ClientProvider/AppProvider,
whose platform collection map includes notification data in managed apps.

NotificationProvider is optional for context/toasts. It requires ClientProvider
above it, defaults autoToast true and toastDuration5000, and permits a custom
renderToast callback returning ReactNode/null. Do not mount one provider per
row or create independent clients for badges.

Visual controls accept items and callbacks; their defaults and optional widths/
grouping/animation are documented in [components](./components.md).
Opening a bell marks seen only when onOpen is wired accordingly.
No prop grants notifications:manage or recipient access.

In custom clients/standalone Sync composition, table definitions and policy
must agree with the server; copying a schema alone does not authorize data.
Use the [SDK](../sdk/index.md) rather than raw socket shortcuts.

- [Hooks](./hooks.md) explains pending authorization and scope retirement.
- [Backend configuration](../../backend/notifications/configuration.md) owns actual startup/cleanup behavior.
