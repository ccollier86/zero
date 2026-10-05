---
id: zero.frontend.components.primitives.tags-validation
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: tags-validation-feedback
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

# Tags And Validation Feedback

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Import TagInput from `@zero/framework/components/ui/tag-input`, ValidationMeter
from `/validation-meter`, and ValidationRules from `/validation-rules`.
These are local input/presentation components, not authentication policy engines.

TagInputProps: value string[] (empty default), onChange, placeholder='Add tag...',
maxTags, allowDuplicates=false, delimiter=',', disabled=false, className,
tagClassName, suggestions and onSearch. value is controlled; the component owns
only its draft text and suggestion visibility. Enter submits a trimmed tag;
Backspace on an empty draft removes the last tag; remove controls emit a new array.
Blank tags are ignored. Duplicate comparison is case-sensitive. Suggestions use
case-insensitive substring matching and omit existing tags unless duplicates are
allowed. onSearch receives the raw draft for an app-owned suggestion source;
the component does not install remote transport or debouncing.

```tsx
import { useState } from 'react';
import { TagInput } from '@zero/framework/components/ui/tag-input';

export function Labels() {
  const [labels, setLabels] = useState<string[]>([]);
  return <TagInput value={labels} onChange={setLabels} maxTags={5} />;
}
```

One delimiter event emits one coherent controlled replacement: each trimmed
candidate is checked against the growing accepted batch, including duplicates
and maxTags. This preserves all accepted items instead of replacing earlier
members with later candidates. Max/duplicate rules are input conveniences,
not server quotas.

## Meter And Rule List

Progress/ProgressProps are exported from the root/React barrels and
@zero/framework/components/progress. value/max/getValueLabel follow the Radix
range contract; omitted/invalid max uses 100 and null/invalid values represent
indeterminate/no filled progress. The indicator normalizes admitted value/max
to the same scale as the accessible range rather than treating every value as
a raw percentage. Progress does not start, poll or cancel the represented job.

ValidationMeterProps requires score, with segments=4, labels, colors,
showLabel=true and className. score is a count of satisfied segments; supply an
integer in the intended range. labels is indexed by score, not score-1, and is
shown only for a positive score with a corresponding label. colors are optional
explicit color strings; source defaults are a four-color strength progression,
not a promise that every color is a semantic theme token.

ValidationRulesProps requires rules (ValidationRule[] of label/met), optionally
showOnlyWhenActive=true, staggerDelay=50ms and className. Every nonempty rules
array renders; showOnlyWhenActive controls initial animation, not automatic
focus/dirty detection. The caller must decide whether to mount the list based on
its field state. Use unique labels for stable rule keys. These widgets show
caller-computed results and do not perform password checks themselves.

## Related Guides And Next Steps

- [Forms](../../forms/index.md) owns actual validation/submission state.
- [Guardian password controls](../../guardian/index.md) owns account policy.
- [Timing hooks](../../hooks/timing.md) supports deliberate suggestion debounce.
