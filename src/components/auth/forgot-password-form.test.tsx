import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ForgotPasswordSuccessState } from './forgot-password-form';
import { passwordResetWaitMessage } from './forgot-password-feedback';
import { passwordResetRequestCooldown } from './use-password-reset-request';

describe('forgot-password success state', () => {
  test('uses privacy-safe copy without claiming or exposing a recipient', () => {
    const markup = renderToStaticMarkup(createElement(ForgotPasswordSuccessState));

    expect(markup).toContain(
      'If an account exists for that address, a reset link will arrive shortly.',
    );
    expect(markup).not.toContain('We sent a reset link');
    expect(markup).toContain('Repeated requests may be delayed for security.');
    expect(markup).toContain('For security, wait another 5 minutes before requesting a new link.');
    expect(markup).not.toContain('@');
    expect(markup).toContain('bg-success/10');
    expect(markup).toContain('text-success');
    expect(markup).not.toContain('green-');
  });

  test('the public configured wait is bounded and older servers retain five-minute guidance', () => {
    expect(passwordResetRequestCooldown(120_000)).toBe(120_000);
    expect(passwordResetRequestCooldown(0)).toBe(0);
    for (const invalid of [undefined, null, '2m', -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(passwordResetRequestCooldown(invalid)).toBe(300_000);
    expect(passwordResetWaitMessage(120)).toContain('2 minutes');
    expect(passwordResetWaitMessage(1)).toContain('1 second before');
    expect(passwordResetWaitMessage(0)).toContain('Other security checks still apply');
  });

  test('the confirmation exposes a disabled resend rather than implying a second email was sent', () => {
    const waiting = renderToStaticMarkup(createElement(ForgotPasswordSuccessState, { remainingSeconds: 120, onRequestAgain() {} }));
    expect(waiting).toContain('disabled'); expect(waiting).toContain('Request another link'); expect(waiting).toContain('2 minutes');
    const ready = renderToStaticMarkup(createElement(ForgotPasswordSuccessState, { remainingSeconds: 0, onRequestAgain() {} }));
    expect(ready).not.toContain('disabled=""'); expect(ready).toContain('You can request another link now');
    expect(waiting).toContain('aria-live="off"');
  });
});
