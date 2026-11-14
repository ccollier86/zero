/** Local wall dates for the UI prototype; no UTC conversion or scheduling authority. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function parseDay(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!, 12);
}
export function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(parseDay(value)) === value;
}
