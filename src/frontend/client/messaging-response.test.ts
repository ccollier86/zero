/** Public wire-shape validation only; capabilities are not proof of current authority or worker health. */
import { expect, test } from 'bun:test';
import { assertMessagingCapabilities } from './messaging-response';

const legacy = { enabled: true, directory: 'everyone', canSupport: false,
  maxMessageLength: 20000, maxParticipants: 100, maxUploadBytes: 16 * 1024 * 1024 };

test('older capability projections remain readable and optional configured integrations are strictly boolean', () => {
  expect(() => assertMessagingCapabilities(legacy)).not.toThrow();
  expect(() => assertMessagingCapabilities({ ...legacy, assistant: true, notifications: false })).not.toThrow();
  for (const key of ['assistant', 'notifications']) for (const value of ['true', 1, null, {}]) {
    expect(() => assertMessagingCapabilities({ ...legacy, [key]: value })).toThrow('Invalid messaging response.');
  }
});
