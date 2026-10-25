import { expect, test } from 'bun:test';
import { resolveLoggingConfig, loggingCaptures } from './logging-config';
import { loggingEvent } from './test-support/logging-fixture';

test('logging is opt-in and its presets expose progressively broader capture without claiming compliance readiness', () => {
  expect(resolveLoggingConfig().enabled).toBe(false); expect(resolveLoggingConfig(false).enabled).toBe(false);
  const basic = resolveLoggingConfig(true), activity = resolveLoggingConfig({ preset: 'activity' }), detailed = resolveLoggingConfig({ preset: 'detailed' });
  expect(basic.capture.security).toBe(true); expect(basic.capture.views).toBe(false);
  expect(activity.capture.records).toBe(true); expect(activity.capture.navigation).toBe(true); expect(activity.capture.clipboard).toBe(false);
  expect(detailed.capture.views).toBe(true); expect(detailed.capture.printing).toBe(true);
  const compliance = resolveLoggingConfig({ preset: 'compliance' });
  expect(compliance.complianceRequested).toBe(true); expect('ready' in compliance).toBe(false);
  expect(compliance.capture.views).toBe(false); expect(compliance.capture.clipboard).toBe(false); expect(compliance.capture.printing).toBe(false);
  expect(resolveLoggingConfig({ preset: 'compliance', capture: { views: true } }).capture.views).toBe(true);
});
test('granular capture can refine a preset; diagnostic severity cannot erase audit evidence', () => {
  const config = resolveLoggingConfig({ preset: 'detailed', minimumLevel: 'fatal', capture: { navigation: false } });
  expect(config.capture.navigation).toBe(false); expect(loggingCaptures(config, loggingEvent())).toBe(true);
  expect(loggingCaptures(config, loggingEvent('diagnostic', null, { family: 'operational', action: 'app.warning', level: 'warn' }))).toBe(false);
  expect(() => resolveLoggingConfig({ preset: 'compliance', capture: { security: false } })).toThrow();
});
test('logging configuration snapshots nested inputs and rejects accessors without executing them', () => {
  const input = { preset: 'detailed' as const, capture: { views: true }, queue: { batchSize: 4 } };
  const config = resolveLoggingConfig(input); input.capture.views = false; input.queue.batchSize = 1;
  expect(config.capture.views).toBe(true); expect(config.queue.batchSize).toBe(4); expect(Object.isFrozen(config.queue)).toBe(true);
  let called = false;
  expect(() => resolveLoggingConfig({ get preset() { called = true; return 'basic' as const; } })).toThrow();
  expect(called).toBe(false);
});
for (const bad of [{ preset: 'verbose' }, { queue: { maxEvents: 0 } }, { queue: { maxBytes: Infinity } }, { queue: { batchSize: 257 } }, { capture: { magic: true } }, { unexpected: true }, { queue: { maxEvents: null } }]) test('invalid logging configuration is rejected: ' + JSON.stringify(bad), () => {
  expect(() => resolveLoggingConfig(bad as any)).toThrow(expect.objectContaining({ code: 'LOGGING_CONFIG_INVALID' }));
});
