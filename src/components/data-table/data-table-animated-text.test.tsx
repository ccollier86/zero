/** Static rendering contracts for the existing TypingText primitive and its table-only replacement adapter. */
import * as React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TypingText, TypingTextCursor } from '../animate-ui/primitives/texts/typing';
import { DataTableAnimatedText } from './data-table-animated-text';

test('replacement SSR is final and canonical on first mount, without a cursor or private DOM props', () => {
  const html = renderToStaticMarkup(<DataTableAnimatedText value="Accepted"><mark>Accepted</mark></DataTableAnimatedText>);
  expect(html).toContain('data-slot="data-table-animated-text"');
  expect(html).toContain('<mark>Accepted</mark>');
  expect(html).not.toContain('typing-text-visual');
  expect(html).not.toContain('data-typing');
  expect(html).not.toContain('mode=');
  expect(html).not.toContain('maxDuration=');
  expect(html).not.toContain('enabled=');
});

test('default legacy TypingText still starts empty and keeps its cursor provider and appended children', () => {
  const html = renderToStaticMarkup(<TypingText text={['First', 'Second']} loop>
    <TypingTextCursor /><span>Appended</span>
  </TypingText>);
  expect(html).toContain('data-slot="typing-text"');
  expect(html).toContain('data-slot="typing-text-cursor"');
  expect(html).toContain('<span>Appended</span>');
  expect(html).not.toContain('First');
  expect(html).not.toContain('Second');
  expect(html).not.toContain('mode=');
});
