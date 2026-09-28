import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mfaChallengeFlowKey } from './mfa-challenge-form';
import { MFAEnrollmentForm, mfaEnrollmentFlowKey } from './mfa-enrollment-form';

describe('MFAEnrollmentForm method selection', () => {
  test('uses the keyboard-operable roving radio pattern', () => {
    const markup = renderToStaticMarkup(createElement(MFAEnrollmentForm, {
      methods: ['totp', 'email'],
    }));

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Two-factor authentication method"');
    expect(markup).toContain('role="radio" aria-checked="true" tabindex="0"');
    expect(markup).toContain('role="radio" aria-checked="false" tabindex="-1"');
    expect(markup).toContain('motion-reduce:transition-none');
  });

  test('resets state when identity or one-time MFA proof changes', () => {
    const settingsEnrollment = mfaEnrollmentFlowKey('user-1', undefined, ['totp', 'email']);
    expect(mfaEnrollmentFlowKey('user-2', undefined, ['totp', 'email']))
      .not.toBe(settingsEnrollment);
    const enrollment = mfaEnrollmentFlowKey(undefined, 'setup-1', ['totp', 'email']);
    expect(mfaEnrollmentFlowKey('user-1', 'setup-2', ['totp', 'email']))
      .not.toBe(enrollment);
    expect(mfaEnrollmentFlowKey('user-1', 'setup-1', ['totp', 'email']))
      .toBe(enrollment);

    const challenge = mfaChallengeFlowKey('challenge-1', 'id-1');
    expect(mfaChallengeFlowKey('challenge-1', 'id-1')).toBe(challenge);
    expect(mfaChallengeFlowKey('challenge-2', 'id-2'))
      .not.toBe(challenge);
  });
});
