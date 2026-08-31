/** Privacy-safe telemetry regressions for administrator user actions. */

import { describe, expect, test } from 'bun:test';
import { AuthClientError } from '../../../frontend/client/auth-client';
import {
  configureFrontendObservability,
  type FrontendObservabilityEvent,
} from '../../../frontend/client/observability';
import { reportAdminUserError } from './admin-user-error';

describe('admin user action errors', () => {
  test('reports target identity and stable server response details', () => {
    let observed: FrontendObservabilityEvent | undefined;
    configureFrontendObservability({
      sink: { emit: (event) => { observed = event; } },
    });

    const error = new AuthClientError('Recovery rejected', 409, 'RECOVERY_REJECTED', {});
    expect(reportAdminUserError(
      'clearPasswordChangeRequirement',
      error,
      { targetUserId: 'target-user' },
    )).toBe(error);
    expect(observed?.metadata).toEqual({
      action: 'clearPasswordChangeRequirement',
      targetUserId: 'target-user',
      status: 409,
      code: 'RECOVERY_REJECTED',
    });

    configureFrontendObservability({ console: false, http: false });
  });
});
