---
id: zero.frontend.forms.wizard
type: reference
audience: [developer, agent]
owner: frontend-forms
status: draft
visibility: internal
system: frontend-forms
feature: wizard
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Schema-Backed Step Forms

[Forms index](./index.md) · [Documentation index](../../index.md)

Wizard renders schema fields in successive UI steps with progress and current-step
validation. It is not a durable Torrent workflow, backend state machine or
automatic persistence service. useForm owns values/final submission; the caller
owns onComplete and its accepted server operation.

## Declaration Fragment

```tsx
import { Wizard } from '@zero/framework/react';

<Wizard
  schema={taskFields}
  steps={[
    { title: 'Task', fields: ['title'] },
    { title: 'Details', fields: ['status', 'estimate'] },
    { title: 'Review', fields: [] },
  ]}
  onComplete={saveEncodedTask}
  completeLabel="Create task"
/>;
```

taskFields must contain the declared fields and saveEncodedTask is the app's
complete callback/promise. A fieldless review step is intentional and valid.
steps must not be empty; unknown fields fail with an actionable configuration
error rather than silently skipping their validation/rendering.

## Navigation And Submission

Next validates current-step fields and exposes their blur/field errors when
invalid. Valid steps receive completion indicators and advance. Back navigates
without requiring the current step to validate. The final action validates its
step and then runs useForm's complete schema validation/submission.

Completion indicators describe step validation/navigation, not authoritative
backend acceptance. onComplete is awaited through useForm; the pending completion
button reflects that operation. The caller handles safe submission error
presentation; Wizard does not add an onError prop or a separate durable retry
engine. A callback must not discard its server promise or announce accepted
success before it resolves.

## Dynamic Configuration

Replacing the schema or changing step titles/field layout resets current step,
direction and completion indicators before the new layout is indexed/rendered.
This prevents stale/out-of-range navigation after shrinking a step list.

Equivalent new step arrays preserve navigation and entered values. Changing only
description does not reset. A configuration reset does not call onStepChange and
does not remount/reset the form instance; value lifecycle remains useForm's own.
Do not rely on defaultValues prop churn to replace the entire active form.

onStepChange fires for deliberate navigation targets. columns defaults one,
completeLabel defaults Complete and className composes presentation. There is no
new arbitrary branch/conditional workflow language in Wizard props.

## Boundaries And Verification

Steps are presentation, not permission. All required/hidden identity and ownership
rules still need the correct values/server authority. Including a field in a
review step cannot grant access or move data into another Fabric realm.

Test empty/unknown rejection, fieldless review, current/final validation, awaiting
completion, shrinking a list at its last step, equivalent arrays and schema/layout
replacement. Focused SSR and actual browser regressions cover those dynamic
contracts; visual/keyboard accessibility and installed-package qualification
remain distinct.

The audited correction rejects configurations that previously crashed/skipped
fields and safely resets changed layouts. It preserves ordinary supported step
and callback shapes, without a forced form remount or a backend workflow change.

## Related Guides And Next Steps

- [Configuration](./configuration.md#wizardprops) lists exact inputs.
- [useForm](./use-form.md) owns values/final validation/submission.
- [Submission and scope](./submission-and-scope.md) connects to accepted writes.
- [FieldRenderer](./field-renderer.md) owns generated step inputs.
