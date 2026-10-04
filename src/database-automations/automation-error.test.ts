import { describe, expect, test } from 'bun:test';

import {
  AUTOMATION_ERROR_CODES,
  AutomationError,
  isAutomationError,
  isAutomationErrorCode,
} from './automation-error';

describe('AutomationError', () => {
  test('exposes a closed, non-retryable definition failure contract', () => {
    const error = new AutomationError(
      'AUTOMATION_TARGET_MISSING',
      ' Target is missing. ',
      {
        details: {
          issueCount: 1,
          target: 'function:orders.rollup@1',
          constructor: 'blocked',
          nested: { private: true },
        } as never,
      },
    );

    expect(error.name).toBe('AutomationError');
    expect(error.message).toBe('Target is missing.');
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({
      issueCount: 1,
      target: 'function:orders.rollup@1',
    });
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(isAutomationError(error)).toBe(true);
  });

  test('recognizes every published code and rejects unknown codes', () => {
    for (const code of AUTOMATION_ERROR_CODES) expect(isAutomationErrorCode(code)).toBe(true);
    expect(isAutomationErrorCode('AUTOMATION_UNKNOWN')).toBe(false);
    expect(() => new AutomationError(
      'AUTOMATION_UNKNOWN' as never,
      'invalid',
    )).toThrow(TypeError);
  });
});
