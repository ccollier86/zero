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
  expect(compliance.diagnostics.http).toBe(false);
  expect(compliance.capture.views).toBe(true); expect(compliance.capture.clipboard).toBe(false); expect(compliance.capture.printing).toBe(false);
  expect(resolveLoggingConfig({ preset: 'compliance', capture: { views: false } }).capture.views).toBe(false);
});
test('technical HTTP tracing is an explicit detached opt-in, not implied by compliance', () => {
  const input = { preset: 'compliance' as const, diagnostics: { http: true } };
  const config = resolveLoggingConfig(input); input.diagnostics.http = false;
  expect(config.diagnostics.http).toBe(true); expect(Object.isFrozen(config.diagnostics)).toBe(true);
  expect(() => resolveLoggingConfig({ diagnostics: { http: 'yes' } } as any)).toThrow();
  expect(() => resolveLoggingConfig({ diagnostics: { other: true } } as any)).toThrow();
});
test('reactive observation and selection rates are separate configured finite policy limits', () => {
  expect(resolveLoggingConfig({ preset: 'activity' }).browser).toEqual({ observationsPerMinute: 240, selectionsPerMinute: 240 });
  const input = { browser: { observationsPerMinute: 2000, selectionsPerMinute: 800 } };
  const policy = resolveLoggingConfig(input); input.browser.observationsPerMinute = 9999;
  expect(policy.browser).toEqual({ observationsPerMinute: 2000, selectionsPerMinute: 800 });
  for (const browser of [{ observationsPerMinute: 0 }, { selectionsPerMinute: 10001 }, { other: 1 }, { selectionsPerMinute: null }]) expect(() => resolveLoggingConfig({ browser } as any)).toThrow();
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
