/** Bounded structural input only. No token authentication, grants or clock admission here. */
import type { CalendarAppointmentOverride, CalendarOverrideGrantInput, CalendarOverrideAuthority } from './override-contracts';
import { CalendarError } from './error';
import { calendarRecord, calendarText, calendarValue } from './validation';
export const CALENDAR_OVERRIDE_POLICY = 'appointment-overlap-v1' as const;
export const CALENDAR_OVERRIDE_STATE = '_calendar_override_state';
export const CALENDAR_OVERRIDE_GRANT_CURRENT = '_calendar_override_grant_current';
export const CALENDAR_OVERRIDE_GRANT_HISTORY = '_calendar_override_grant_history';
export const CALENDAR_OVERRIDE_ADMISSIONS = '_calendar_override_admissions';
export const CALENDAR_OVERRIDE_HISTORY = '_calendar_appointment_override_history';
export const CALENDAR_OVERRIDE_WITNESSES = '_calendar_override_witnesses';
export const CALENDAR_OVERRIDE_LIMITS = Object.freeze({ witnesses: 64, ttlMs: 300_000, grantHistory: 100_000, history: 100_000, retainedWitnesses: 1_000_000 });
export function normalizeCalendarAppointmentOverride(input: unknown): Readonly<CalendarAppointmentOverride> {
  const r = calendarRecord(calendarValue(input), ['policyVersion', 'decisionToken', 'reason']);
  if (r.policyVersion !== CALENDAR_OVERRIDE_POLICY) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const decisionToken = calendarText(r.decisionToken, 256), reason = calendarText(calendarText(r.reason, 1024).trim(), 1024);
  // Authentication and expiry deliberately occur only after original receipt lookup.
  if (!/^co1\.[0-9]{1,16}\.[0-9]{1,16}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(decisionToken)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return Object.freeze({ policyVersion: CALENDAR_OVERRIDE_POLICY, decisionToken, reason });
}
export function normalizeCalendarOverrideGrant(input: unknown): Readonly<CalendarOverrideGrantInput> {
  const r = calendarRecord(calendarValue(input), ['categories']);
  if (!Array.isArray(r.categories) || r.categories.length > 1 || r.categories.some(value => value !== 'appointment-overlap')) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return Object.freeze({ categories: Object.freeze(r.categories.slice()) as readonly 'appointment-overlap'[] });
}
export function normalizeCalendarOverrideAuthority(input: unknown): Readonly<CalendarOverrideAuthority> {
  const r = calendarRecord(input, ['policyVersion', 'policyHash', 'use', 'manageGrants']);
  if (r.policyVersion !== CALENDAR_OVERRIDE_POLICY || typeof r.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.policyHash)
    || typeof r.use !== 'boolean' || typeof r.manageGrants !== 'boolean') throw new CalendarError('CALENDAR_INPUT_INVALID');
  return Object.freeze({ policyVersion: CALENDAR_OVERRIDE_POLICY, policyHash: r.policyHash, use: r.use, manageGrants: r.manageGrants });
}
