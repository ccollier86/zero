/**
 * Verifies the public markup and accessibility contract for StreamingText.
 * Effect-driven source consumption remains owned by React; these tests cover
 * the stable server-rendered states applications hydrate from.
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { StreamingText, type StreamSource } from './streaming-text';

describe('StreamingText', () => {
  test('renders static text without a live region or cursor', () => {
    const markup = renderToStaticMarkup(
      <StreamingText
        text="Stored answer"
        id="answer"
        className="text-muted-foreground"
      />,
    );

    expect(markup).toContain('id="answer"');
    expect(markup).toContain('data-slot="streaming-text"');
    expect(markup).toContain('data-status="idle"');
    expect(markup).toContain('text-pretty whitespace-pre-wrap text-muted-foreground');
    expect(markup).toContain('Stored answer');
    expect(markup).not.toContain('data-slot="streaming-text-cursor"');
    expect(markup).not.toContain('aria-live=');
  });

  test('renders caller-owned streaming text with a semantic cursor and polite announcements', () => {
    const markup = renderToStaticMarkup(
      <StreamingText text="Partial answer" streaming />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('Partial answer');
    expect(markup).toContain('data-slot="streaming-text-cursor"');
    expect(markup).toContain('bg-foreground');
    expect(markup).toContain('motion-reduce:animate-none');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('class="sr-only"');
  });

  test('can disable both the cursor and announcements', () => {
    const markup = renderToStaticMarkup(
      <StreamingText text="Quiet update" streaming cursor={false} announce="off" />,
    );

    expect(markup).toContain('Quiet update');
    expect(markup).not.toContain('streaming-text-cursor');
    expect(markup).not.toContain('aria-live=');
  });

  test('accepts a custom cursor without wrapping or replacing it', () => {
    const markup = renderToStaticMarkup(
      <StreamingText
        text="Custom"
        streaming
        cursor={<span data-testid="custom-cursor">|</span>}
      />,
    );

    expect(markup).toContain('data-testid="custom-cursor"');
    expect(markup).toContain('>|</span>');
    expect(markup).not.toContain('data-slot="streaming-text-cursor"');
  });

  test('starts text replay and async sources in the streaming state', () => {
    const replayMarkup = renderToStaticMarkup(
      <StreamingText text="Replay me" speed={55} />,
    );
    const source: StreamSource = (async function* () {
      yield 'chunk';
    })();
    const sourceMarkup = renderToStaticMarkup(<StreamingText source={source} />);

    for (const markup of [replayMarkup, sourceMarkup]) {
      expect(markup).toContain('data-status="streaming"');
      expect(markup).toContain('data-slot="streaming-text-cursor"');
      expect(markup).toContain('aria-live="polite"');
    }
    expect(replayMarkup).not.toContain('Replay me');
    expect(sourceMarkup).not.toContain('chunk');
  });
});
