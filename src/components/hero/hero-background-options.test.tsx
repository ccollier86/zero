/** Verifies optional background descriptors without starting visual effects. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Hero } from './hero';

test('empty options remain a background descriptor, not an invalid React child', () => {
  const html = renderToStaticMarkup(<Hero title="Example" background={{}} />);
  expect(html).toContain('Example');
  expect(html).toContain('aria-hidden="true"');
});

test('class-only options customize the default preset', () => {
  const html = renderToStaticMarkup(<Hero title="Example" background={{ className: 'synthetic-background' }} />);
  expect(html).toContain('synthetic-background');
  expect(html).toContain('Example');
});

test('explicit none and custom nodes preserve their meanings', () => {
  const disabled = renderToStaticMarkup(<Hero title="Example" background={{ preset: 'none' }} />);
  expect(disabled).not.toContain('aria-hidden="true"');
  const custom = renderToStaticMarkup(<Hero title="Example" background={<div data-custom="true" />} />);
  expect(custom).toContain('data-custom="true"');
});
