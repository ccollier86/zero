/** One native viewport, additive presentation options and stable Root attributes under SSR. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScrollArea, type ScrollAreaProps } from './scroll-area';

test('page chaining and rail orientation belong to the viewport/decoration, not leaked Root DOM props', () => {
  const options: ScrollAreaProps = { orientation: 'both', scrollbarOrientation: 'vertical', scrollChaining: 'auto' };
  const markup = renderToStaticMarkup(<ScrollArea {...options} aria-label="Records" data-testid="area" style={{ height: 160 }}>
    <p>Retained content</p>
  </ScrollArea>);
  expect(markup.match(/data-radix-scroll-area-viewport=/g)).toHaveLength(1);
  expect(markup).toContain('overscroll-behavior:auto');
  expect(markup).toContain('aria-label="Records"'); expect(markup).toContain('height:160px');
  expect(markup).toContain('Retained content');
  expect(markup).not.toContain('scrollChaining'); expect(markup).not.toContain('scrollbarOrientation');
});

test('ordinary floating/control ScrollArea remains contained unless page chaining is explicitly requested', () => {
  const markup = renderToStaticMarkup(<ScrollArea>Native control content</ScrollArea>);
  expect(markup).toContain('overscroll-behavior:contain');
  expect(markup.match(/data-radix-scroll-area-viewport=/g)).toHaveLength(1);
  expect(markup).not.toContain('zero-scroll-track'); // no invented SSR geometry
});
