import { describe, expect, test } from 'bun:test';
import type { AuthConfigState } from '../../frontend/client/auth-hooks';
import {
  canShowForgotPasswordLink,
  canShowRegistrationLink,
  isAuthConfigPending,
  isAuthConfigUnavailable,
  isPasswordResetUnavailable,
  isRegistrationClosed,
} from './auth-config-ui-policy';

describe('auth config UI policy', () => {
  test('treats policy-aware links as pending while config is loading', () => {
    const state = makeState({ config: null, isLoading: true });

    expect(isAuthConfigPending(true, state)).toBe(true);
    expect(canShowRegistrationLink(true, true, state)).toBe(false);
    expect(canShowForgotPasswordLink(true, true, state)).toBe(false);
  });

  test('allows first-admin bootstrap registration from loaded config', () => {
    const state = makeState({
      config: {
        registration: {
          mode: 'admin-only',
          bootstrapRequired: true,
          publicRegistrationEnabled: true,
          userCount: 0,
        },
      },
      canRegister: true,
    });

    expect(isRegistrationClosed(true, state)).toBe(false);
    expect(canShowRegistrationLink(true, true, state)).toBe(true);
  });

  test('treats failed config loading as unavailable for policy-aware forms', () => {
    const state = makeState({
      config: null,
      isLoading: false,
      error: 'Failed to load auth config',
    });

    expect(isAuthConfigUnavailable(true, state)).toBe(true);
    expect(isAuthConfigUnavailable(false, state)).toBe(false);
  });

  test('hides closed registration and disabled password reset from loaded config', () => {
    const state = makeState({
      config: {
        registration: {
          mode: 'admin-only',
          bootstrapRequired: false,
          publicRegistrationEnabled: false,
          userCount: 1,
        },
        accountEmails: {
          adminCreatedUser: true,
          passwordReset: false,
          passwordChangedNotice: true,
        },
      },
      canRegister: false,
    });

    expect(isRegistrationClosed(true, state)).toBe(true);
    expect(canShowRegistrationLink(true, true, state)).toBe(false);
    expect(isPasswordResetUnavailable(true, state)).toBe(true);
    expect(canShowForgotPasswordLink(true, true, state)).toBe(false);
  });
});

function makeState(partial: Partial<AuthConfigState>): AuthConfigState {
  return {
    config: null,
    isLoading: false,
    error: null,
    canRegister: false,
    bootstrapRequired: false,
    reload: async () => {},
    ...partial,
  };
}
