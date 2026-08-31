import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ForgotPasswordSuccessState } from './forgot-password-form';

describe('forgot-password success state', () => {
  test('uses privacy-safe copy without claiming or exposing a recipient', () => {
    const markup = renderToStaticMarkup(createElement(ForgotPasswordSuccessState));

    expect(markup).toContain(
      'If an account exists for that address, a reset link will arrive shortly.',
    );
    expect(markup).not.toContain('We sent a reset link');
    expect(markup).not.toContain('@');
  });
});
