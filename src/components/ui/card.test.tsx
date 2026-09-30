import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardTitle } from './card';

describe('CardTitle', () => {
  test('preserves its div default while allowing an explicit semantic heading', () => {
    const defaultMarkup = renderToStaticMarkup(
      createElement(CardTitle, null, 'Default title'),
    );
    const headingMarkup = renderToStaticMarkup(
      createElement(
        CardTitle,
        { asChild: true },
        createElement('h2', null, 'Management title'),
      ),
    );

    expect(defaultMarkup).toMatch(
      /^<div[^>]*data-slot="card-title"[^>]*>Default title<\/div>$/,
    );
    expect(headingMarkup).toMatch(
      /^<h2[^>]*data-slot="card-title"[^>]*>Management title<\/h2>$/,
    );
    expect(headingMarkup).not.toContain('<div');
  });
});
