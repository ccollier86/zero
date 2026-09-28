import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OTPInput } from './otp-input';

describe('OTPInput accessibility layout', () => {
  test('keeps six slots usable on narrow auth cards and honors reduced motion', () => {
    const markup = renderToStaticMarkup(createElement(OTPInput, {
      value: '',
      onChange: () => {},
    }));

    expect(markup).toContain('max-w-full overflow-x-auto');
    expect(markup).toContain('size-9');
    expect(markup).toContain('sm:size-10');
    expect(markup).toContain('motion-reduce:transition-none');
  });
});
