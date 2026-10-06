---
id: zero.frontend.components.signature-pad
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: signature-pad
maturity: supported
applies_to: ["Zero 2.3.0 Signature Pad; not in the published 2.2.1 archive"]
modes: [browser, SSR, controlled, native-form, agreement, clause-initials]
reviewed_against:
  package: "@zero/framework"
  version: "2.3.0"
  commit: "b3a583038ab7635d29a6d21ba960688429854e1c"
  snapshot: clean
  date: "2026-10-06"
  evidence_level: implementation-verified
---

# Signature Pad

[Component index](./index.md) · [Frontend index](../index.md) · [Documentation index](../../index.md)

The Signature Pad family captures handwritten signatures or initials using a
mouse, pen, or touch. Compose a muted pad with pinned Clear/Save actions, add
an undo/redo toolbar, submit a native form field, or use the agreement and
clause-initials prefabs. The same immutable drawing model powers every variant.

The family is included in Zero 2.3.0, not the older 2.2.1 archive. The release's
fresh packed-consumer gate verifies root/React/focused export identity, browser
bundling and DOM-free server rendering. Documentation-tree publication remains
separate from component availability.

The component captures ink; it does not establish a person's identity, verify
legal consent, assign a trusted date, or persist anything automatically. The
application owns those contracts and its authenticated server operation.

## Public Imports

```tsx
import {
  SignaturePad, SignaturePadArea, SignaturePadGuide, SignaturePadPlaceholder,
  SignaturePadControls, SignaturePadClear, SignaturePadUndo, SignaturePadRedo,
  SignaturePadSave, SignaturePadPreview, useSignaturePad,
  SignatureAgreementCard, ClauseInitials,
  type SignaturePadStroke, type SignaturePadApi,
} from '@zero/framework/components/signature-pad';
```

These components are also exported from `@zero/framework/react` and the
framework root. Prefer the focused subpath when only this component family is
needed. It uses Zero's existing Button, Input, Checkbox, Card, Badge, icon, and
light/dark token conventions. No AppProvider is needed for local drawing;
application-owned persistence can use the normal authenticated SDK.

## Muted Surface With Pinned Actions

This complete UI component awaits an application-supplied save function. The
callback receives a canonical SVG data URL and the exact immutable strokes.
It must reject when its server operation is not accepted.

```tsx
'use client';

import {
  SignaturePad, SignaturePadArea, SignaturePadGuide, SignaturePadPlaceholder,
  SignaturePadControls, SignaturePadClear, SignaturePadSave,
  type SignaturePadStroke,
} from '@zero/framework/components/signature-pad';

export function SignatureField({ scopeKey, save }: {
  scopeKey: string;
  save: (svg: string, strokes: readonly SignaturePadStroke[]) => Promise<void>;
}) {
  return <SignaturePad scopeKey={scopeKey}>
    <SignaturePadArea variant="muted" className="h-52" aria-label="Your signature">
      <SignaturePadPlaceholder>Sign your name here</SignaturePadPlaceholder>
      <SignaturePadGuide />
      <SignaturePadControls position="bottom-end">
        <SignaturePadClear />
        <SignaturePadSave onSave={save} />
      </SignaturePadControls>
    </SignaturePadArea>
  </SignaturePad>;
}
```

`SignaturePadArea` owns pointer input and the SVG drawing surface. Its variants
are `default`, `muted`, and `ghost`. Give it a meaningful accessible name and a
bounded height. `SignaturePadControls` positions its children inside the pad:
`top-start`, `top-end`, `bottom-start`, or `bottom-end`. Keep adequate drawing
space when adding both top and bottom groups, especially on narrow screens.

Place the optional `SignaturePadGuide` and `SignaturePadPlaceholder` inside the
area. Placeholder content disappears when the drawing contains ink. Overlay
actions do not begin a stroke when clicked. Cancelled input, lost pointer
capture, a retired scope, or a changed external drawing does not commit an
unfinished stroke.

`SignaturePadSave` disables submission while empty, drawing, disabled,
read-only, or already saving. Pending save locks local drawing/history actions
and prevents duplicate clicks. Success leaves the drawing available; it does
not clear the pad or imply that the application stored it. A rejection restores
editable state and reports a sanitized framework error. Late completions from
a retired draft/scope or unmounted control cannot alter the current UI.

For specialized wrappers, `onSave` may return `false` to decline the generic
accepted feedback instead of reporting success. `showFeedback` defaults to
`true`; setting `showFeedback={false}` hides
the Save control's inline result presentation when the surrounding feature
owns its own success/error display; it does not turn a rejected operation into
an accepted write or grant server authority. Agreement cards use their actual
receipt state, never the generic callback-success text, to display signing.

## History Toolbar And Keyboard Shortcuts

Use the same actions inside a separate toolbar or within pinned controls:

```tsx
import {
  SignaturePad, SignaturePadArea, SignaturePadUndo, SignaturePadRedo,
  SignaturePadClear,
} from '@zero/framework/components/signature-pad';

export function SignatureWithHistory() {
  return <SignaturePad>
    <div role="toolbar" aria-label="Signature history" className="mb-2 flex gap-2">
      <SignaturePadUndo /><SignaturePadRedo /><SignaturePadClear />
    </div>
    <SignaturePadArea variant="muted" className="h-48" aria-label="Signature" />
  </SignaturePad>;
}
```

Undo and redo operate on completed strokes and clear operations, not individual
pointer samples. History retains up to 100 transitions. Within the pad root,
Ctrl/Command+Z undoes, Ctrl/Command+Shift+Z redoes, and Ctrl+Y also redoes.
Shortcuts do not intercept typing controls/contenteditable or unrelated page
controls. Disabled/read-only, active drawing, and pending saves guard imperative
history methods as well as buttons.

History/actions and form validation are keyboard accessible, but handwriting
itself is pointer input. If the product requires a keyboard-only signing
alternative, provide an application-authorized equivalent flow rather than
treating focusability as the ability to draw a handwritten signature.

## Native SVG Form Field, Required Validation And Reset

`name` adds a native form field containing the serialized signature. Default
`format="svg"` submits a `data:image/svg+xml;charset=utf-8,...` URL; `json`
submits the validated stroke array as JSON. Empty ink is the empty string, so
`required` participates in native form validation. It does not prove identity.

```tsx
'use client';

import * as React from 'react';
import {
  SignaturePad, SignaturePadArea, SignaturePadPlaceholder, SignaturePadClear,
} from '@zero/framework/components/signature-pad';
import { Button } from '@zero/framework/components/ui/button';

export function ConsentForm({ submit }: { submit: (body: FormData) => Promise<void> }) {
  const [pending, setPending] = React.useState(false);
  return <form onSubmit={async (event) => {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    setPending(true);
    try { await submit(body); } finally { setPending(false); }
  }}>
    <SignaturePad name="signature" required disabled={pending}>
      <SignaturePadArea variant="muted" aria-label="Required consent signature" className="h-48">
        <SignaturePadPlaceholder>Your signature is required</SignaturePadPlaceholder>
      </SignaturePadArea>
      <SignaturePadClear />
    </SignaturePad>
    <div className="mt-3 flex gap-2">
      <Button type="reset" variant="outline" disabled={pending}>Reset</Button>
      <Button type="submit" disabled={pending}>Submit</Button>
    </div>
  </form>;
}
```

The application-supplied `submit` function owns authenticated transport, error
presentation, and persistence. Native Reset restores `defaultValue` and clears
history; a prevented form reset leaves the draft unchanged. Use `form="form-id"`
to associate an out-of-tree pad with an existing form. Disabled fields are
excluded from FormData. Read-only ink remains displayable/submittable but is
not an editable required field.

`defaultValue` accepts strokes, not an SVG string. Controlled pads request a
reset through `onValueChange`; the parent must accept the requested value.
An uncontrolled pad stores its draft locally. SSR produces the initial field
value without allocating a canvas or accessing the browser.

## Acknowledged Agreement Card

`SignatureAgreementCard` combines agreement content, optional signer-name and
consent controls, the pad, and a signing action. It becomes read-only only after
the application returns a valid signed-date acknowledgement.

```tsx
import {
  SignatureAgreementCard,
  type SignatureAgreementPayload, type SignatureAgreementAcknowledgement,
} from '@zero/framework/components/signature-pad';

export function ProjectAgreement({ documentKey, sign }: {
  documentKey: string;
  sign: (payload: SignatureAgreementPayload) => Promise<SignatureAgreementAcknowledgement>;
}) {
  return <SignatureAgreementCard sourceKey={documentKey}
    title="Project agreement" description="Review these terms before signing."
    requireConsent consentLabel="I agree to the terms below." onSign={sign}>
    <p>The application supplies the agreement terms and stores the accepted document.</p>
  </SignatureAgreementCard>;
}
```

The payload contains `svg` (a raw canonical SVG document), `strokes` (an
immutable copy), and `signerName` (trimmed display text). `onSign` returns
`{ signedAt: string, signerName?: string }`, with a UTC ISO date/time ending in
`Z`. The server should supply the trusted time and canonical identity
after authorization and persistence; do not create a client timestamp merely
to make the UI appear signed.

The receipt binds that acknowledgement to the submitted ink. Rejection or an
invalid acknowledgement leaves the draft unsigned and retryable. A successful
`onSigned(receipt)` notification cannot undo the accepted signature if the
notification itself fails. `signed` can supply a persisted receipt with
`signedAt`, `strokes`, and optional `signerName`/`svg`; display regenerates SVG
from validated strokes, never renders an arbitrary supplied SVG document.
Rejected or retired signing attempts must not display a generic "accepted"
message; a signing receipt is the only state that locks this card.

`sourceKey` is required. Change it with the organization/document/revision
being signed, and reset any parent-controlled drawing/name/receipt at that same
boundary. It fences stale callbacks; it is not server authorization. The name
field is shown by default (`showSignerName`); `requireConsent` defaults to
`false`. No signing callback means signing is unavailable, not locally accepted.

## Compact Initial Pads For Clauses

`ClauseInitials` renders one small pad per clause with a completion count.
Clause IDs stay stable while display labels or ordering change.

```tsx
import { ClauseInitials } from '@zero/framework/components/signature-pad';

export function ContractInitials({ documentKey }: { documentKey: string }) {
  return <ClauseInitials scopeKey={documentKey} namePrefix="initials" required
    clauses={[
      { id: 'confidentiality', label: 'Confidentiality', description: 'Keep shared information private.' },
      { id: 'delivery', label: 'Delivery', description: 'Approve the delivery schedule.' },
    ]} />;
}
```

An initial is complete when that clause's current drawing has ink. The counter
uses the current clauses, not removed entries. `value`/`defaultValue` are records
mapping clause IDs to stroke arrays; `onValueChange` receives the updated record.
`required` defaults to `false`. With `namePrefix`, each native field is named
`${namePrefix}.${clauseId}` and submits an SVG data URL. Without a name prefix,
the component still works as a local/controlled UI but does not invent form
field names. `disabled`, `readOnly`, and `scopeKey` apply to every pad.

Native form Reset restores each clause's initial `defaultValue`, or empty ink
when no initial mark was supplied. Multiple pads reset as one coherent map;
one field's reset must not restore another field's just-cleared initials.

## Drawing State, API And Export Configuration

| Root prop | Contract/default |
| --- | --- |
| `value`, `onValueChange` | Parent-owned readonly strokes and requested immutable snapshots. |
| `defaultValue` | Initial strokes; empty by default. Also the form-reset baseline. |
| `apiRef` | Current `SignaturePadApi` for outside toolbars or form integration. |
| `scopeKey` | UI lifetime identity; change on document/authorization boundary. |
| `disabled`, `readOnly` | Both prohibit interactive/imperative edits; disabled also excludes the native field. |
| `name`, `form`, `required`, `format` | Native field name/form ownership; required false; format svg. |
| `color` | Optional solid ink color; omitted display follows the pad text token. |
| `minWidth`, `maxWidth` | Ink diameter in CSS pixels; defaults 0.8 and 3.2, positive/ordered/bounded. |
| `smoothing` | Coordinate smoothing in [0, 1]; default 0.5. |
| `sizing` | `auto` (default), `pressure`, or `velocity`; auto uses pen pressure and mouse/touch velocity. |
| `pointerTypes` | Accepted mouse/pen/touch kinds; all by default. An empty list admits none. |
| `onStrokeStart`, `onStrokeEnd` | Start pointer kind and accepted completed immutable stroke. Cancellation does not report a completed stroke. |

### Agreement And Clause Configuration

| Agreement prop | Contract/default |
| --- | --- |
| `sourceKey` | Required nonempty document/scope lifetime key. |
| `title`, `description`, `children` | Title defaults to Agreement; optional description and agreement body. |
| `value`, `defaultValue`, `onValueChange` | Controlled/local drawing contract; default is empty ink. |
| `signed` | Optional persisted receipt; valid ink/date lock the current lifetime. Invalid receipts fail closed for display. |
| `signerName`, `defaultSignerName`, `onSignerNameChange` | Controlled/local display name; default local name is empty. |
| `showSignerName`, `signerNameLabel` | Show a name field by default; label defaults to Full name. |
| `requireConsent`, `consentLabel` | Consent is optional by default; default copy is I have read and agree to the terms above. |
| `onSign`, `onSigned` | Application acknowledgement and optional accepted-receipt notification; no implicit server operation. |
| `signLabel` | Signing action text; defaults to Sign agreement. |
| `disabled`, `readOnly` | Disable admission or show read-only content; false by default. |

| Clause prop | Contract/default |
| --- | --- |
| `clauses` | Required current clause array with unique, nonempty stable IDs, labels and optional descriptions. |
| `value`, `defaultValue`, `onValueChange` | Controlled/local ID-to-ink record; omitted entries are empty. |
| `scopeKey` | Optional document/organization lifetime key; change it when draft ownership changes. |
| `title`, `description` | Default Clause initials and Add your initials beside each clause. |
| `namePrefix`, `form` | Optional native field prefix and out-of-tree form ID; no field names are invented. |
| `required` | False by default; native validation requires ink in each current editable clause. |
| `disabled`, `readOnly` | Apply to every clause pad; false by default. |

Both prefabs accept normal div attributes and `className`. They do not read
environment variables, register Doctor settings, discover server configuration,
or automatically enforce an application's permission policies.

`SignaturePadStroke` has `points: readonly [x, y, size][]` and optional solid
`color`. Coordinates are CSS pixels from the area's origin. Imported data is
bounded and deeply copied; malformed points/colors/options are rejected.
Renaming a field or storing an image URL is not the same as restoring strokes.

`useSignaturePad()` requires the root provider and returns the same API exposed
through `apiRef`: `strokes`, `isEmpty`, `isDrawing`, `canUndo`, `canRedo`,
`disabled`, `readOnly`, `clear()`, `undo()`, `redo()`, `reset()`, `focus()`,
`toSVG()`, `toDataURL()`, `toBlob()`, and `serialize()`.

SVG export is independent of the display theme. Strokes without their own color
export black by default. Options accept `color`, optional solid `background`,
`padding` (8 by default), `crop` (true by default), and bounded positive
`width`/`height`. Both dimensions specify a fixed frame; `crop: false` retains
the area's origin. `toSVG()` returns raw SVG, `toDataURL()` an SVG data URL,
and `toBlob()` an asynchronous SVG Blob or `null` for empty ink. `serialize()`
returns SVG-data-URL or JSON text; empty ink is `''`. PNG/JPEG raster export is
not part of this API.

`SignaturePadPreview` displays validated strokes without a provider or editable
surface. It is suitable for already-authorized receipt previews, not arbitrary
remote SVG markup. External controlled replacement compares every point;
changing an interior point resets incompatible history and cancels active ink.

The focused subpath also exposes pure helpers: `signaturePadToSVG`,
`signaturePadToDataURL`, `signaturePadToBlob`, `serializeSignaturePad`,
`snapshotSignaturePadStrokes`, `hasSignaturePadInk`, `getSignaturePadBounds`,
and `getSignaturePadStrokePath`. Export helpers accept the same options as the
API; `snapshotSignaturePadStrokes` validates and returns an immutable defensive
copy. Ink admission allows at most 1,000 strokes and 100,000 total points,
finite coordinates within ±1,000,000 and positive diameters at most 256.
Validate request size and authorization before admitting any untrusted drawing
on the server. Geometry helpers are presentation tools, not a signature-proof
or cryptographic verification API.

## Security, Errors And Verification

Treat signature drawings and signer names as sensitive application data. Enforce
Guardian permissions, organization ownership, expected revision/document
binding, storage policy, retention, and server-side validation in the actual
save/sign endpoint. Disabled controls, completion counts, scope keys, or a
read-only card are not authorization and are not evidence of legal validity.

Save and notification failures use Zero's
[frontend observability boundary](../observability.md).
Events contain static messages and bounded operation/error codes, never ink,
serialized SVG, signer names, private callback exceptions, or document content.
Ordinary change/stroke callback notifications are scope-bound rather than
discarded by the accepted ink change: an asynchronous rejection still reports
within the same document, while a retired scope or unmount suppresses it.
Avoid copying those values into application logs, analytics, or generic errors.

For integration, check mouse/stylus/touch input, cancellation, undo/redo, the
required empty form state, reset and cancelled reset, your server rejection,
double-click prevention, the acknowledged date/lock, and organization/document
switches during a pending operation. Verify narrow layouts and both themes.
No backend schema, migration, route, or storage drive is introduced by adding
these UI components.

## Related Guides

- [Forms](../forms/index.md) explains field submission and app-owned draft/persistence boundaries.
- [Design system](../design-system/index.md) owns themes, semantic colors, and visual composition.
- [Guardian](../../backend/guardian/index.md) owns identity, authorization, and organization policy.
- [Storage Studio](../storage/index.md) owns durable signature files and their actual access controls.
- [Observability](../../backend/observability/index.md) explains safe frontend events and custom sinks.
- [ReUI Signature Pad](https://reui.io/components/signature-pad) is the MIT-licensed upstream interaction source; Zero's integration and authority contracts are documented here.
