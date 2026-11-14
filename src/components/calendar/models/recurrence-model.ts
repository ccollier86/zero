/** Bounded date previews and saved preferences, not a recurring-booking engine. */
import { dateKey, isDay, parseDay } from './calendar-date';

export type RepeatEnd = { kind: 'never' } | { kind: 'on'; date: string } | { kind: 'after'; count: number };
export type RepeatFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type MonthPattern = { kind: 'day'; day: number } | { kind: 'weekday'; ordinal: number; weekday: number };
export type RepeatRule = { interval: number; end: RepeatEnd } & (
  | { frequency: 'daily' }
  | { frequency: 'weekly'; weekdays: number[] }
  | { frequency: 'monthly'; pattern: MonthPattern }
  | { frequency: 'yearly' }
);
export const weekdays = [
  { day: 1, short: 'M', name: 'Monday' }, { day: 2, short: 'T', name: 'Tuesday' },
  { day: 3, short: 'W', name: 'Wednesday' }, { day: 4, short: 'T', name: 'Thursday' },
  { day: 5, short: 'F', name: 'Friday' }, { day: 6, short: 'S', name: 'Saturday' }, { day: 0, short: 'S', name: 'Sunday' },
];
export const ordinals = [{ value: 1, label: 'first' }, { value: 2, label: 'second' }, { value: 3, label: 'third' }, { value: 4, label: 'fourth' }, { value: 5, label: 'fifth' }, { value: -1, label: 'last' }];
export function defaultRepeat(frequency: RepeatFrequency, start: string, interval = 1, end: RepeatEnd = { kind: 'never' }): RepeatRule {
  const day = parseDay(start);
  if (frequency === 'weekly') return { frequency, interval, end, weekdays: [day.getDay()] };
  if (frequency === 'monthly') return { frequency, interval, end, pattern: { kind: 'day', day: day.getDate() } };
  return { frequency, interval, end };
}
export function cloneRepeat(rule: RepeatRule | null): RepeatRule | null {
  if (!rule) return null;
  return { ...rule, end: { ...rule.end }, ...(rule.frequency === 'weekly' ? { weekdays: [...rule.weekdays] } : {}), ...(rule.frequency === 'monthly' ? { pattern: { ...rule.pattern } } : {}) } as RepeatRule;
}
export function repeatError(rule: RepeatRule | null, start: string): string | null {
  if (!rule) return null;
  if (!isDay(start)) return 'Choose a valid appointment date first.';
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 99) return 'Choose an interval from 1 to 99.';
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(rule.frequency)) return 'Choose a repeat frequency.';
  if (rule.frequency === 'weekly' && (!rule.weekdays.length || rule.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(rule.weekdays).size !== rule.weekdays.length)) return 'Choose at least one day of the week.';
  if (rule.frequency === 'monthly') {
    const p = rule.pattern;
    if (p.kind === 'day' ? !Number.isInteger(p.day) || p.day < 1 || p.day > 31 : p.kind !== 'weekday' || !ordinals.some(item => item.value === p.ordinal) || !Number.isInteger(p.weekday) || p.weekday < 0 || p.weekday > 6) return 'Choose a valid monthly pattern.';
  }
  if (rule.end.kind === 'on' && (!isDay(rule.end.date) || rule.end.date < start)) return 'The end date cannot be before the first appointment.';
  if (rule.end.kind === 'after' && (!Number.isInteger(rule.end.count) || rule.end.count < 1 || rule.end.count > 999)) return 'Choose between 1 and 999 occurrences.';
  if (!['never', 'on', 'after'].includes(rule.end.kind)) return 'Choose when the repeat ends.';
  return null;
}
function canonical(rule: RepeatRule | null): string {
  if (!rule) return 'none';
  return JSON.stringify([rule.frequency, rule.interval, rule.frequency === 'weekly' ? [...rule.weekdays].sort() : rule.frequency === 'monthly' ? rule.pattern.kind === 'day' ? ['day', rule.pattern.day] : ['weekday', rule.pattern.ordinal, rule.pattern.weekday] : null, rule.end.kind, rule.end.kind === 'after' ? rule.end.count : rule.end.kind === 'on' ? rule.end.date : null]);
}
export function sameRepeat(a: RepeatRule | null, b: RepeatRule | null): boolean { return canonical(a) === canonical(b); }
export function repeatSummary(rule: RepeatRule | null, start: string, includeEnd = true): string {
  if (!rule) return 'Does not repeat';
  if (repeatError(rule, start)) return 'Custom repeat';
  const every = (singular: string, plural: string) => rule.interval === 1 ? `Every ${singular}` : `Every ${rule.interval} ${plural}`;
  let label: string;
  if (rule.frequency === 'daily') label = every('day', 'days');
  else if (rule.frequency === 'weekly') {
    const ordered = weekdays.filter(day => rule.weekdays.includes(day.day));
    label = rule.interval === 1 && ordered.map(day => day.day).join(',') === '1,2,3,4,5' ? 'Every weekday' : `${every('week', 'weeks')} on ${ordered.map(day => day.name.slice(0, 3)).join(', ')}`;
  } else if (rule.frequency === 'monthly') {
    const pattern = rule.pattern;
    label = `${every('month', 'months')} on ${pattern.kind === 'day' ? `day ${pattern.day}` : `the ${ordinals.find(item => item.value === pattern.ordinal)?.label} ${weekdays.find(day => day.day === pattern.weekday)?.name}`}`;
  }
  else label = `${every('year', 'years')} on ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parseDay(start))}`;
  if (!includeEnd) return label;
  if (rule.end.kind === 'after') return `${label} · ${rule.end.count} ${rule.end.count === 1 ? 'occurrence' : 'occurrences'}`;
  return rule.end.kind === 'on' ? `${label} · until ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parseDay(rule.end.date))}` : label;
}
/** Includes the first appointment; no overflowing month days are silently clamped. */
export function repeatPreview(rule: RepeatRule | null, start: string, requested = 4): string[] {
  if (!isDay(start) || repeatError(rule, start)) return [];
  const limit = Math.max(1, Math.min(12, Math.floor(requested) || 1));
  const first = parseDay(start), result = [start];
  if (!rule) return result;
  const count = rule.end.kind === 'after' ? Math.min(limit, rule.end.count) : limit;
  let stopped = false;
  function add(day: Date) {
    if (day.getFullYear() > 9999) { stopped = true; return; }
    const key = dateKey(day);
    if (key <= start) return;
    if (rule!.end.kind === 'on' && key > rule!.end.date) { stopped = true; return; }
    if (result.length < count) result.push(key);
  }
  // All supported patterns have a candidate within a bounded Gregorian cycle.
  for (let cycle = 0; cycle < 400 && result.length < count && !stopped; cycle++) {
    if (rule.frequency === 'daily') { const day = new Date(first); day.setDate(day.getDate() + (cycle + 1) * rule.interval); add(day); }
    else if (rule.frequency === 'weekly') {
      const monday = new Date(first); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7 + cycle * rule.interval * 7);
      for (const weekday of weekdays.filter(day => rule.weekdays.includes(day.day))) { const day = new Date(monday); day.setDate(day.getDate() + (weekday.day + 6) % 7); add(day); if (stopped || result.length >= count) break; }
    } else if (rule.frequency === 'monthly') {
      const day = new Date(first.getFullYear(), first.getMonth() + cycle * rule.interval, 1, 12), month = day.getMonth();
      if (rule.pattern.kind === 'day') day.setDate(rule.pattern.day);
      else if (rule.pattern.ordinal === -1) { day.setMonth(month + 1, 0); day.setDate(day.getDate() - (day.getDay() - rule.pattern.weekday + 7) % 7); }
      else day.setDate(1 + (rule.pattern.weekday - day.getDay() + 7) % 7 + (rule.pattern.ordinal - 1) * 7);
      if (day.getMonth() === month) add(day);
    } else {
      const year = first.getFullYear() + (cycle + 1) * rule.interval;
      const day = new Date(year, first.getMonth(), first.getDate(), 12);
      if (day.getMonth() === first.getMonth()) add(day);
    }
  }
  return result;
}
export function repeatPresets(start: string): Array<{ id: string; label: string; rule: RepeatRule | null }> {
  if (!isDay(start)) return [{ id: 'none', label: 'Does not repeat', rule: null }];
  const date = parseDay(start), weekday = weekdays.find(day => day.day === date.getDay())!.name;
  const monthly: RepeatRule = { frequency: 'monthly', interval: 1, pattern: { kind: 'weekday', ordinal: Math.ceil(date.getDate() / 7), weekday: date.getDay() }, end: { kind: 'never' } };
  return [
    { id: 'none', label: 'Does not repeat', rule: null },
    { id: 'daily', label: 'Every day', rule: defaultRepeat('daily', start) },
    { id: 'weekdays', label: 'Every weekday (Mon–Fri)', rule: { frequency: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5], end: { kind: 'never' } } },
    { id: 'weekly', label: `Weekly on ${weekday}`, rule: defaultRepeat('weekly', start) },
    { id: 'biweekly', label: `Every 2 weeks on ${weekday}`, rule: defaultRepeat('weekly', start, 2) },
    { id: 'monthly', label: `Monthly on the ${ordinals.find(item => item.value === Math.ceil(date.getDate() / 7))!.label} ${weekday}`, rule: monthly },
    { id: 'yearly', label: repeatSummary(defaultRepeat('yearly', start), start), rule: defaultRepeat('yearly', start) },
  ];
}
