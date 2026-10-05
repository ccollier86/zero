---
id: zero.frontend.components.text.streaming-text
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: streaming-text
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

# StreamingText

[Text index](./index.md) · [Documentation index](../../../index.md)

Import StreamingText, StreamSource, StreamingTextProps and StreamingTextStatus
from `@zero/framework/components/streaming-text`, root or React.
StreamSource is AsyncIterable<string> or ReadableStream<string>. Convert provider
protocol objects/bytes into strings in the owning transport, not in this component.

## Three Presentation Modes

```tsx
import { StreamingText } from '@zero/framework/components/streaming-text';

export function StoredAnswer({ text }: { text: string }) {
  return <StreamingText text={text} />;
}

export function LiveAnswer({ source }: {
  source: AsyncIterable<string> | ReadableStream<string>;
}) {
  return <StreamingText source={source} />;
}
```

These are component fragments; the live producer is caller-owned and must have a
stable identity for one run. A new source object resets displayed run content.
Static text with speed=0 displays immediately. Positive speed with no source
replays text; speed means approximate characters/second, with a minimum 16ms
interval and batched advancement for high rates. source takes precedence over
text/replay. Supplying streaming explicitly controls cursor/live presentation
while an app owns text updates; it does not start a producer or change the
internal source/replay status into an external transport status.

## Props And Completion

Props inherit div attributes except children. text/source/speed are optional;
speed defaults 0. streaming is optional. cursor defaults to a token-based pulse;
false removes it and a ReactNode supplies a custom cursor. announce defaults
sentences; off disables the live region. onDone(text),onError(unknown) and
onStatusChange(status) observe React effect-driven run state. Status values are
idle/streaming/done/error; static text begins idle, source/replay begins streaming,
and source exhaustion/replay completion becomes done. These notifications are not
exactly-once durable events or workflow receipts; normal React effect lifecycle
applies. Keep callback work safe and use a server engine for durable actions.

Source strings append without Markdown/HTML parsing, preserving whitespace/newlines.
Failure leaves already accumulated text and calls onError; sanitize presentation
and route diagnostics through the app's [observability](../../observability.md).
The component is not a toast/error-boundary replacement.

## Accessibility And Ownership

The visible value is hidden from assistive technology while actively streaming.
For source/replay runs, a polite live region announces complete punctuation/newline
segments and flushes an unfinished tail after 1000ms idle or completion. A custom
external text/streaming composition owns any additional announcement strategy;
it is not transformed into internal source chunks automatically. The default
cursor is decorative and respects reduced-motion CSS.

Replacing source/unmount aborts the component's admission of later results and
retires replay/idle timers. It does not call the provider's AbortController or
ReadableStream.cancel. A pending producer read may settle later; its state result
is ignored. The reader lock releases when iteration ends. The caller owns network
cancellation, source lifetime and persistence. Keep source creation outside each
unrelated render, and reset/unmount the display on an authority boundary when
showing organization-specific content.

Adaptation attribution/license remains in source. Browser/SSR tests present and
focused execution evidence do not qualify every provider or device flow.

## Related Guides And Next Steps

- [AI gateway](../../../backend/ai/index.md) owns production/model/tool execution.
- [Scroll anchoring](../scroll-anchoring.md) follows transcript growth deliberately.
- [Configuration](./configuration.md) locates all text-control props and imports.
