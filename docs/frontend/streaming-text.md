# Streaming Text

`StreamingText` renders text from a completed value, a timed text replay, or a
live string stream. Use it for AI responses, agent output, transcripts being
assembled in real time, and any interface where text arrives in chunks.

Unlike `TypewriterEffect`, this component does not add an artificial delay in
front of a real stream. It displays each live chunk as the source yields it and
announces completed sentences through a polite live region.

## Import

Prefer the narrow package import in app code:

```tsx
import { StreamingText } from '@zero/framework/components/streaming-text';
```

The broad React barrel also exports the component and its types:

```tsx
import {
  StreamingText,
  type StreamSource,
  type StreamingTextProps,
  type StreamingTextStatus,
} from '@zero/framework/react';
```

## Live string streams

Pass an `AsyncIterable<string>` or `ReadableStream<string>` through `source`.
The component consumes one source instance, appends chunks in arrival order,
and reports `done` or `error` when the source settles.

```tsx
function Answer({ stream }: { stream: AsyncIterable<string> }) {
  return (
    <StreamingText
      source={stream}
      onDone={(answer) => saveAnswer(answer)}
      onError={(error) => reportError(error)}
    />
  );
}
```

Browser `Response.body` streams normally contain bytes. Decode them before
passing them to `StreamingText`:

```tsx
const response = await fetch('/api/answer');
const source = response.body?.pipeThrough(new TextDecoderStream());

return source ? <StreamingText source={source} /> : null;
```

Keep the `source` object stable for one run. Supplying a different source
identity starts a fresh run and prevents output from the previous source from
being appended to it.

## Caller-owned streaming state

If an SDK or hook already accumulates text, pass the current value through
`text` and control the cursor/live state with `streaming`:

```tsx
<StreamingText
  text={message.text}
  streaming={message.status === 'streaming'}
/>
```

This is the simplest integration for AI clients that expose progressively
updated message text rather than an async iterable.

## Static text and replay

With only `text`, the value renders immediately and no live region is mounted.
Set `speed` above zero to replay a known string at approximately that many
characters per second:

```tsx
<StreamingText
  text="The migration is ready to review."
  speed={55}
  onDone={(text) => markPreviewComplete(text)}
/>
```

Replay is useful for demos and canned examples. Do not use it to slow an
already-live AI response. Treat `text` and `speed` as the identity and timing
of one replay; remount or provide a new text value to intentionally restart it.

## Cursor and styling

The default cursor uses Zero's semantic `foreground` token and stops pulsing
when the user requests reduced motion. Root HTML attributes and `className`
are forwarded to the wrapping `div`.

```tsx
<StreamingText
  source={stream}
  className="text-sm leading-relaxed text-foreground"
  cursor={<span aria-hidden="true" className="text-primary">▍</span>}
/>
```

Pass `cursor={false}` to remove the cursor. The component introduces no
one-off palette and works in Zero light and dark themes without additional
token configuration.

## Accessibility

While text is arriving, the rapidly changing visible value is hidden from
assistive technology. A separate `aria-live="polite"` region announces whole
sentences when punctuation arrives, flushes an incomplete sentence after one
second of inactivity, and flushes the remaining text on completion. Static
text does not populate a live region or re-announce itself on mount.

Use `announce="off"` when another component already announces the same output
or when the stream is decorative. The default cursor is decorative and honors
`prefers-reduced-motion`.

## API

| Prop | Type | Default | Purpose |
| --- | --- | --- | --- |
| `text` | `string` | | Static content, caller-owned progressive text, or the script replayed by `speed`. |
| `source` | `AsyncIterable<string> \| ReadableStream<string>` | | Live string chunks consumed once and appended as they arrive. Takes precedence over replayed `text`. |
| `speed` | `number` | `0` | Approximate characters per second for a known-text replay. Zero renders immediately. |
| `streaming` | `boolean` | internal status | Overrides whether caller-owned text is currently streaming. |
| `cursor` | `ReactNode \| false` | tokenized block cursor | Replaces or removes the trailing cursor. |
| `announce` | `"sentences" \| "off"` | `"sentences"` | Enables sentence-level polite announcements for live output. |
| `onDone` | `(text: string) => void` | | Receives the full accumulated value after a source or replay completes. |
| `onError` | `(error: unknown) => void` | | Receives an error thrown by the live source. |
| `onStatusChange` | `(status: "idle" \| "streaming" \| "done" \| "error") => void` | | Runs when the internal status changes. |

All normal `HTMLAttributes<HTMLDivElement>` except `children` are also
accepted. Text content is supplied only through `text` or `source`.

## Source copy

Use the packaged component by default. Copy it only when an application needs
to own and customize the implementation:

```sh
zero add components/streaming-text
```

The copied component brings the shared `cn` helper with it. The implementation
is adapted from Mischief UI's
[MIT-licensed Streaming Text component](https://github.com/Tinkerers-Labs/mischief-ui/blob/92c335bf6910007b95e282a6e0a1168555b86cf1/registry/default/streaming-text/streaming-text.tsx);
Zero's package and copied source preserve the required Tinkerers Labs notice.
