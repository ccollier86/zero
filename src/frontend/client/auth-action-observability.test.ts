import { afterEach, describe, expect, test } from 'bun:test';

import { OBS_CODES } from '../../observability/codes';
import { reportAuthClientActionFailure } from './auth-action-observability';
import { AuthClientError } from './auth-errors';
import {
  configureFrontendObservability,
  type FrontendObservabilityEvent,
} from './observability';

afterEach(() => {
  configureFrontendObservability({ console: false, http: false });
});

describe('auth client action observability', () => {
  test('emits the stable auth action code with bounded metadata', () => {
    const events: FrontendObservabilityEvent[] = [];
    configureFrontendObservability({
      sink: { emit: (event) => { events.push(event); } },
    });

    reportAuthClientActionFailure(
      'tenantMembers',
      new AuthClientError('Forbidden', 403, 'FORBIDDEN', { private: 'not serialized' }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      code: OBS_CODES.FRONTEND_AUTH_ACTION_FAILED.code,
      metadata: { action: 'tenantMembers', code: 'FORBIDDEN' },
      error: { name: 'AuthClientError', message: 'Forbidden' },
    });
    expect(JSON.stringify(events[0])).not.toContain('not serialized');
  });
});
