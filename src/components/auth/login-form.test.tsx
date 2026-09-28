import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginForm, type LoginFormProps } from './login-form';

// Keep accepting the historical prop so existing applications remain source
// compatible, while avoiding a cosmetic promise the AuthClient cannot honor.
const legacyRememberMe: LoginFormProps = { showRememberMe: true };

describe('LoginForm persistence controls', () => {
  test('does not render a nonfunctional remember-me promise', () => {
    const markup = renderToStaticMarkup(createElement(LoginForm, legacyRememberMe));

    expect(markup).not.toContain('Remember me');
    expect(markup).not.toContain('login-remember');
  });
});
