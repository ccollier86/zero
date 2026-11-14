/** Free-form minute precision. Quick-pick intervals do not constrain entered times. */
export function parseTimeEntry(input: string): number {
  const match = input.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap](?:\.?m\.?)?)?$/i);
  if (!match) return NaN;
  let hour = Number(match[1]); const minute = Number(match[2] ?? 0), period = match[3]?.[0]?.toLowerCase();
  if (minute > 59) return NaN;
  if (period) { if (hour < 1 || hour > 12) return NaN; hour = hour % 12 + (period === 'p' ? 12 : 0); }
  else if (hour > 23) return NaN;
  return hour * 60 + minute;
}
