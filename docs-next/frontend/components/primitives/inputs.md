---
id: zero.frontend.components.primitives.inputs
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: native-inputs
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

# Buttons, Inputs, Textareas And Labels

[Primitive index](./index.md) · [Frontend index](../../index.md) · [Documentation index](../../../index.md)

Use `@zero/framework/components/ui/button`, `/input`, `/textarea` and
`/label`. Button and Input expose ButtonProps/InputProps on their own modules;
other native wrappers can be typed with React.ComponentProps<typeof Component>.

```tsx
import { Button } from '@zero/framework/components/ui/button';
import { Input } from '@zero/framework/components/ui/input';
import { Label } from '@zero/framework/components/ui/label';

export function SearchField() {
  return (
    <div>
      <Label htmlFor="query">Search</Label>
      <Input id="query" name="query" type="search" />
      <Button type="submit">Find</Button>
    </div>
  );
}
```

This is markup composition, not a persisted form or table search adapter. For
standard table search use [DataTableSearch](../../data-controls/data-table/controls.md)
so source state, scope and query behavior remain connected.

## Button

Button accepts native button props plus asChild (false), animateIcon (true),
variant and size. Variants: default, destructive, outline, secondary, ghost,
link. Sizes: default, xs, sm, lg, icon, icon-xs, icon-sm, icon-lg. Default variant
and size are default. buttonVariants is a style helper exported by this module.

asChild uses a Radix slot and needs a compatible single child. It changes the
rendered element; it does not give an anchor native disabled-button semantics.
animateIcon adds hover/tap AnimateIcon context, not an automatic async action
runner. Supply type='button' for non-submit buttons inside forms; ordinary native
button default submission behavior otherwise applies. Awaited mutations and
pending/confirmation state belong to the app or higher-level controls.

## Input, Textarea And Label

Input forwards an HTMLInputElement ref and native input attributes. Non-hidden
inputs render inside a motion border wrapper; className/ref belong to the actual
input, not that wrapper. type='hidden' renders a plain hidden input. disabled,
focus/blur callbacks and aria-invalid are preserved. This is a controlled native
input when value/onChange are supplied; it does not debounce, normalize or save.

`readOnly` is native read-only, not disabled: the input remains focusable,
selectable/copyable and submittable. Working source on the 2.5.0 baseline now
also suppresses the editable hover cue while retaining the keyboard focus
indicator. `wrapperClassName` is an additive composition hook for the outer
border wrapper; `className` still styles the actual input. Hidden inputs have no
wrapper. These additions are not in the published 2.5.0 archive. Composite
controls such as [PhoneInput](../phone-input.md#read-only-disabled-and-native-forms)
honor read-only for their attached selectors too. None of these props enforces
server write authority.

Textarea accepts native textarea props, with token-based focus/invalid styling
and an 80px minimum height. Label uses the Radix label contract, including htmlFor.
Give fields stable IDs and accessible names; visual placeholders are not complete
labels. Keep field error messages associated through aria-describedby.

## Related Guides And Next Steps

- [Forms](../../forms/index.md) adds schema validation and accepted submission.
- [Choice controls](./choices.md) adds select/checkbox/radio interaction.
- [Generic actions](../../hooks/state-and-actions.md) manages caller-owned command state.
