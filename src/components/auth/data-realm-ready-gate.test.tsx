import { describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DataRealmReadinessNotice,
  DataRealmReadyGate,
} from './data-realm-ready-gate';
import type { UseDataRealmReadinessResult } from '../../frontend/client/data-realm-readiness-hooks';

describe('DataRealmReadyGate', () => {
  it('renders children only for a usable realm', () => {
    const markup = renderToStaticMarkup(createElement(DataRealmReadyGate, {
      readiness: readiness('ready'),
      children: createElement('div', { id: 'application-data' }, 'Private rows'),
    }));

    expect(markup).toContain('id="application-data"');
    expect(markup).toContain('Private rows');
  });

  it('keeps children unmounted while provisioning', () => {
    const state = readiness('provisioning');
    const markup = renderToStaticMarkup(createElement(DataRealmReadyGate, {
      readiness: state,
      children: createElement('div', { id: 'application-data' }, 'Private rows'),
    }));

    expect(markup).not.toContain('application-data');
    expect(markup).toContain('Preparing application data');
    expect(markup).toContain('aria-busy="true"');
  });

  it('shows a safe retry affordance without exposing the error code', () => {
    const state = readiness('failed');
    const markup = renderToStaticMarkup(createElement(DataRealmReadinessNotice, {
      readiness: state,
    }));

    expect(markup).toContain('Application data is not ready');
    expect(markup).toContain('Retry setup');
    expect(markup).not.toContain('IDENTITY_PROJECTION_NOT_READY');
  });
});

function readiness(
  status: 'ready' | 'provisioning' | 'failed',
): UseDataRealmReadinessResult {
  const pending = status === 'provisioning';
  const ready = status === 'ready';
  const failed = status === 'failed';
  return {
    status,
    snapshot: {
      status,
      scope: 'tenant',
      pendingOperations: pending ? 1 : 0,
      retryable: failed,
      errorCode: failed ? 'IDENTITY_PROJECTION_NOT_READY' : null,
      updatedAt: 42,
      pollAfterMs: pending ? 500 : null,
    },
    isReady: ready,
    isPending: pending,
    isLoading: false,
    isProvisioning: pending,
    isFailed: failed,
    canRetry: failed,
    errorCode: failed ? 'IDENTITY_PROJECTION_NOT_READY' : null,
    refresh: async () => {},
    retry: async () => {},
  };
}
