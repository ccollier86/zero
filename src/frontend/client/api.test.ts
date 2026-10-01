import { describe, expect, test } from 'bun:test';
import { ApiError, unwrap } from './api';

describe('unwrap', () => {
  test('returns successful Eden data', () => {
    expect(unwrap({ data: { ok: true }, error: null })).toEqual({ ok: true });
  });

  test('preserves structured Zero error messages, codes, status, and body', () => {
    const body = { error: 'Workflow not found', code: 'WORKFLOW_NOT_FOUND' };
    expect(() => unwrap({
      data: null,
      error: { status: 404, value: body },
    })).toThrow(ApiError);

    try {
      unwrap({ data: null, error: { status: 404, value: body } });
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        message: 'Workflow not found',
        status: 404,
        code: 'WORKFLOW_NOT_FOUND',
        body,
      });
    }
  });

  test('keeps non-object Eden errors readable', () => {
    expect(() => unwrap({
      data: null,
      error: { status: 503, value: 'Unavailable' },
    })).toThrow('Unavailable');
  });
});
