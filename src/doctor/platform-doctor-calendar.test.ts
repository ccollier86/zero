/** Pure configuration checks only; no runtime, fixture, files or dependencies generated. */
import { expect, test } from 'bun:test';
import { resolveCalendarConfig } from '../calendar/config';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { checkCalendar } from './platform-doctor-calendar';
import type { PlatformDoctorFinding } from './platform-doctor-contracts';
test('calendar Doctor stays inert when disabled and distinguishes configuration from operational readiness', () => {
  const findings: PlatformDoctorFinding[] = [];
  checkCalendar({ calendar: false }, findings); expect(findings).toEqual([]);
  const auth = resolveAuthBehaviorConfig({ tenancy: 'single' });
  const missing = resolveCalendarConfig(true, '/synthetic-doctor-calendar-never-created', auth);
  checkCalendar({ calendar: missing }, findings);
  expect(findings).toContainEqual(expect.objectContaining({ code: 'calendar.setup.timezone_required', severity: 'warning' }));
  findings.length = 0;
  checkCalendar({ calendar: resolveCalendarConfig({ timezone: 'UTC' }, '/synthetic-doctor-calendar-never-created', auth) }, findings);
  expect(findings.map(finding => finding.code)).toEqual(['calendar.core.configured']);
  expect(findings[0]!.hint).toContain('not actor/storage readiness');
  expect(JSON.stringify(findings)).not.toContain('synthetic-doctor-calendar-never-created');
});
