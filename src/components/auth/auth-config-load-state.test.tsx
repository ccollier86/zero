import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthConfigState } from '../../frontend/client/auth-hooks';
import { AuthConfigLoadState } from './auth-config-load-state';

describe('AuthConfigLoadState', () => {
  test('fails closed without inventing a disabled capability', () => {
    expect(render(state({ status: 'unknown' }))).toBe('');
    expect(render(state({ status: 'unknown' }), true)).toContain(
      'Loading access policy…',
    );
  });

  test('renders a bounded retry state without exposing transport text', () => {
    const markup = render(state({
      status: 'error',
      error: 'private upstream response body',
    }));

    expect(markup).toContain('Access policy could not be loaded.');
    expect(markup).toContain('Retry');
    expect(markup).not.toContain('private upstream response body');
  });

  test('renders nothing once a config is available', () => {
    const markup = render(state({
      status: 'ready',
      config: {
        registration: {
          mode: 'disabled',
          bootstrapRequired: false,
          publicRegistrationEnabled: false,
        },
      },
    }));
    expect(markup).toBe('');
  });
});

function render(authConfig: AuthConfigState, showUnknown = false): string {
  return renderToStaticMarkup(createElement(AuthConfigLoadState, {
    state: authConfig,
    loadingMessage: 'Loading access policy…',
    unavailableMessage: 'Access policy could not be loaded.',
    showUnknown,
  }));
}

function state(partial: Partial<AuthConfigState>): AuthConfigState {
  return {
    status: 'unknown',
    config: null,
    isLoading: false,
    error: null,
    canRegister: false,
    bootstrapRequired: false,
    reload: async () => {},
    ...partial,
  };
}
