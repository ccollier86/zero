---
id: zero.frontend.modals.layouts
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: layouts
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

# Layouts That Keep The Frame Consistent

[Modals index](./index.md) · [Documentation index](../../index.md)

The unreleased structured shell separates title/description/actions from feature
content. Its header and footer do not scroll; the content body does. Feature code
does not construct an extra frame, close button, header or footer.

## Content And Decisions

Use the default content layout for a form, preview, long prose or picker. A short
decision can omit body entirely. Title is always required; icon/meta/description
and footer note are optional. Longer content is capped to available viewport height,
with edge dividers reflecting content underneath the fixed frame.

~~~tsx
modals.show({
  title: "Release notes",
  meta: "October update",
  description: "Changes relevant to this workspace.",
  body: <ReleaseNotes />,
  footer: { start: "Changes apply to all workspace members." },
  actions: [{ id: "done", label: "Done", variant: "primary", value: true }],
});
~~~

This fragment assumes modals imported from the React facade and an app-owned
ReleaseNotes component. Use existing Zero controls within the body.

## Horizontal Tabs

~~~tsx
modals.show({
  title: "Project settings",
  size: "lg",
  layout: "tabs",
  initialSection: "general",
  sections: [
    { id: "general", label: "General", body: <GeneralSettings /> },
    { id: "members", label: "Members", badge: 12, body: <MemberSettings /> },
    { id: "notifications", label: "Notifications", body: <NotificationSettings /> },
  ],
  actions: [{ id: "done", label: "Done", variant: "primary", value: true }],
});
~~~

Settings components are app-owned. Tabs use fixed height by default, so changing
panels does not resize the frame. Panels render when first visited and remain
mounted afterward; drafts and per-panel scroll positions survive tab changes.
Arrow/Home/End behavior follows the underlying accessible tab primitive.

## Grouped Side Navigation

Switch layout to `nav`; section.group names establish navigation groups:

~~~tsx
modals.show({
  title: "Preferences",
  size: "xl",
  layout: "nav",
  sections: [
    { id: "profile", group: "Account", label: "Profile", body: <ProfileSettings /> },
    { id: "security", group: "Account", label: "Security", body: <SecuritySettings /> },
    { id: "integrations", group: "Workspace", label: "Integrations", body: <Integrations /> },
  ],
});
~~~

The navigation and active panel scroll independently. At phone widths the side
navigation becomes a horizontal tab strip; group labels are not forced into
tiny viewport columns. Header/footer remain anchored.

## Placement, Sizing And Scrollbars

Choose center(default), left, right or bottom placement. Use sm/md/lg/xl/full
presets and optional custom CSS dimensions, retaining viewport constraints.
Phone layouts use a bottom-sheet frame except full-screen size; do not add
absolute positioning to content to imitate the shell.

`height:"fixed"` holds a stable frame; `auto` grows only until the viewport cap.
`scrollbar:"hidden"` removes scrollbar chrome, not scrollability. Independent
`navScrollbar` configuration applies to navigation. Use explicit labeled forms
and deliberate wrapped content at narrow widths; min-width constraints prevent
titles/trailing controls from pushing the frame offscreen.

For dense members/notifications/integration rows, use
[DenseList](../components/dense-list.md). A fully actionable picker uses
DenseListChoice; a row with Select/Switch/Button uses DenseListItem so controls
remain separate native interactions.

## Related Guides And Next Steps

[Configuration](./configuration.md) lists all options; [motion](./motion.md)
defines panel transitions; [forms](./forms.md) coordinates retained editors;
[migration](./migration.md) removes copied frames safely.
