---
id: zero.frontend.components.sensitive-display
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: secret-field-qr
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

# Browser-Held Secrets And QR Presentation

[Component index](./index.md) · [Frontend index](../index.md) · [Documentation index](../../index.md)

SecretField masks/reveals/copies an already authorized browser-held string. QRCode
renders a string as a themed matrix. Neither component issues credentials,
authorizes a viewer, encrypts a secret or prevents browser inspection.
Do not deliver a secret to a caller who must not possess it.

## SecretField

Import SecretField/SecretFieldProps from `@zero/framework/components/secret-field`,
the root or React barrel. Props extend native div attributes except children and
native onCopy. value is required. Defaults: visiblePrefix=0,visibleSuffix=4,
defaultMasked=true,revealable=true,copyable=true,label='Secret'. Optional masked
and onMaskedChange form the controlled visibility request pair; onCopied and
onCopyError are completion notifications.

```tsx
import { SecretField } from '@zero/framework/components/secret-field';

export function IssuedKey({ value }: { value: string }) {
  return <SecretField value={value} label="New API key" visibleSuffix={4} />;
}
```

Render this after a legitimately authorized issuance response. The full value is
in component memory even when the DOM displays bullets. Do not save it to local
storage or diagnostics merely for later reveal. Use [Guardian API keys](../guardian/index.md)
for creation/rotation/revocation, credential ceilings and one-time delivery.

Masking counts Unicode code points. Nonempty values retain at least one hidden
character; readable prefix has priority over suffix when clamped. The hidden
middle displays up to 24 bullets, not one bullet for every byte. revealable=false
forces masked presentation even if masked=false and removes the reveal control;
it does not disable copying unless copyable=false too. Controlled masked state
remains caller-owned. Uncontrolled state resets to defaultMasked before committing
a replacement value, preventing a prior reveal from flashing the new secret.

Copy uses the complete value, not its visible suffix. A permitted browser
clipboard is required; unavailable/rejected writes produce stable secret-free
errors and the standard frontend copy-failure event. onCopied receives no secret;
onCopyError receives the safe Error. Status resets after 1600ms. Value replacement
and unmount retire old in-flight completion, so key A cannot report success for
key B. Revealed text can be selected on focus/click. The root exposes data-masked
and data-copy-state for deliberate styling; min-width/truncation support dense rows.

The implementation retains attribution/license for its Tinkerers Labs adaptation.
It is not a new server-side key vault.

## QRCode

Import QRCode/QRCodeProps from `@zero/framework/components/qr-code`, root or React.
value is required; size=192,margin=4,robustness='M',title='QR code',className and
moduleClassName are optional. robustness follows qrcode error-correction levels
L/M/Q/H. The component uses a DOM/CSS grid with theme colors and a quiet margin,
not a generated download/image service. Whitespace-only values display a labeled
unavailable state. Supply sensible positive size/nonnegative integer margin.

```tsx
import { QRCode } from '@zero/framework/components/qr-code';

export function PublicLinkCode() {
  return <QRCode value="https://example.test/help" title="Help page QR code" />;
}
```

For MFA/setup credentials, the string is still sensitive browser-held data. The
component only renders it; Guardian must verify setup separately. Test contrast,
quiet zone and scanning on target devices before claiming a usable QR flow.

## Related Guides And Next Steps

- [Guardian interfaces](../guardian/index.md) owns authenticated key/MFA workflows.
- [Table sizing](../data-controls/data-table/state-and-columns.md) prevents long
  revealed values from resizing the table.
- [Frontend observability](../observability.md) owns safe diagnostics, never raw secrets.
