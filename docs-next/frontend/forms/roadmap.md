---
id: zero.frontend.forms.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
feature: roadmap
maturity: planned
applies_to: [future proposals]
---

# Forms And Editing Direction

[Forms index](./index.md) · [Documentation index](../../index.md)

These user-proposed directions are not current configuration flags or committed
delivery dates. Existing schema forms, accepted submissions and persistent draft
hooks already provide their documented foundations.

- [ ] Design reusable autosave integration for forms/editors that preserves active
  editing, handles accepted writes/uncertain outcomes and does not reset progress
  on every synchronization. Persistent drafts are useful building blocks, not
  proof that every form already has automatic conflict-safe autosave.
- [ ] Evaluate richer editor plugins, including Markdown/rich-text choices, with
  shared design tokens and non-disruptive save behavior. This is recorded product
  direction, not an installed editor dependency or a new field builder.
- [ ] Consider later graphical form-building tools using supported schema metadata
  and server policies. A GUI must not create a second permission/validation language.

The audit's required/default/null/receipt/step-layout corrections are actual
defect fixes, not future limitations to accept. Qualify the completed new manuals
and component behavior before publication.

## Related Guides And Next Steps

- [AutoForm](./auto-form.md) explains today's generated form.
- [Wizard](./wizard.md) owns current step behavior.
- [Configuration](./configuration.md) is the current props reference.
