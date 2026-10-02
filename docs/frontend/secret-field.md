# Secret Field

`SecretField` is Zero's display-only control for API keys, tokens, signing
secrets, and other values that an authorized browser has already received. It
renders a token-aware masked value with optional reveal and full-value copy
actions. It is not an input and does not edit, submit, fetch, authorize, store,
rotate, or revoke the value.

## Import

Prefer the narrow package import in app code:

```tsx
import { SecretField } from '@zero/framework/components/secret-field';
```

The browser-safe React barrel exports the component and prop type as well:

```tsx
import { SecretField, type SecretFieldProps } from '@zero/framework/react';
```

## Basic use

```tsx
<SecretField
  label="Webhook signing secret"
  value={signingSecret}
  visiblePrefix={8}
  visibleSuffix={4}
/>
```

The field starts masked by default. Copy always writes the complete `value`,
not the masked presentation. `label` supplies the accessible names and status
copy for the reveal and copy controls; it defaults to `Secret`.

The component uses Zero's semantic border, card, foreground, muted, accent,
success, and destructive tokens, so it follows the application's light/dark
theme without a component-specific palette. HTML `div` attributes and
`className` are forwarded to the root.

## Masking

`visiblePrefix` defaults to `0` and `visibleSuffix` defaults to `4`. Counts are
normalized and clamped so visible segments never overlap. A non-empty masked
value always retains at least one hidden character. The hidden region is
represented by a bounded run of at most 24 mask glyphs, so a long credential
does not make the control arbitrarily wide.

Masking is a shoulder-surfing and accidental-disclosure aid, not an
authorization boundary. The complete `value` remains in browser memory so the
component can reveal or copy it. Only render `SecretField` after the server has
authorized the current user to receive that value. Do not place a raw secret
in logs, URLs, durable browser storage, server-rendered data attributes, or
analytics metadata.

## Controlled and uncontrolled state

Use `defaultMasked` for uncontrolled state. It defaults to `true`:

```tsx
<SecretField value={token} defaultMasked={false} />
```

Use `masked` with `onMaskedChange` when the caller owns visibility:

```tsx
function ControlledSecret({ value }: { value: string }) {
  const [masked, setMasked] = React.useState(true);

  return (
    <SecretField
      value={value}
      masked={masked}
      onMaskedChange={setMasked}
    />
  );
}
```

When `value` changes, the component clears copy feedback, fences any delayed
result from the previous value, and returns uncontrolled visibility to
`defaultMasked`. A controlled caller remains responsible for its next
`masked` value.

Set `revealable={false}` when policy requires the display to remain masked.
That setting forces the effective masked state even if `masked={false}` and
removes the reveal action:

```tsx
<SecretField
  label="Production token"
  value={token}
  visiblePrefix={8}
  visibleSuffix={4}
  revealable={false}
/>
```

Set `copyable={false}` to remove the copy action. Disabling reveal does not
disable copying; configure the two policies independently.

## Copy lifecycle

The built-in copy action writes the complete value with the browser Clipboard
API and exposes accessible `idle`, `copied`, and `error` feedback. The callbacks
do not return the credential:

```tsx
<SecretField
  value={secret}
  onCopied={() => auditCopyCompleted()}
  onCopyError={(error) => reportClipboardFailure(error)}
/>
```

`onCopied` receives no arguments. `onCopyError` receives a stable,
secret-free `Error`; Zero does not forward an arbitrary browser rejection or
add the secret to the error or its built-in observability event. Keep
application error reporting secret-free as well.

When the value is revealed, its text is keyboard-focusable and focus or click
selects the complete value, including content clipped by the visual field. This
provides a manual-copy path when the Clipboard API is unavailable or denied.

## Guardian one-time API keys

Guardian's packaged API-key controls use `SecretField` for the one-time value
returned by issue and rotation. The control starts masked, shows the stable
`zero_ak_v1.` prefix and final four characters, and copies the complete key.
If automatic copy fails after the operator requests it, Guardian reveals,
focuses, and selects the complete key for keyboard-safe manual copying.
The surrounding warning requires the operator to choose **Dismiss and clear
from page** before continuing with another key action. Dismissal removes the
raw value from that component's in-memory state; it cannot erase a value that
was already copied to the system clipboard or saved elsewhere by the
operator.

## Owning a source copy

Use the packaged component unless an application needs to customize its source.
To create an app-owned copy with its dependencies and rewritten public imports:

```sh
zero add components/secret-field
```

`zero add` skips existing files by default. Review the plan with `--dry-run`
and use `--force` only when intentionally replacing an existing app-owned copy.
