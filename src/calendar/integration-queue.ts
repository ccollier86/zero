/** One durable cursor arbitrates bounded source probes; reads only preview its next selection.
 * 013 numbering is permanent: expired claims (0), obsolete-policy acceptance (1), ordinary ready (2).
 */
export function selectCalendarIntegrationQueue<T extends { readonly id: string }>(classes: readonly (readonly T[])[], start: number, limit: number) {
  const positions = classes.map(() => 0), seen = new Set<string>(), selected: T[] = [];
  let nextClass = start;
  while (selected.length < limit) {
    let found = false;
    for (let offset = 0; offset < classes.length; offset++) {
      const index = (nextClass + offset) % classes.length, rows = classes[index]!;
      while (positions[index]! < rows.length && seen.has(rows[positions[index]!]!.id)) positions[index]!++;
      const row = rows[positions[index]!];
      if (!row) continue;
      positions[index]!++; seen.add(row.id); selected.push(row);
      nextClass = (index + 1) % classes.length; found = true; break;
    }
    if (!found) break;
  }
  return { selected, nextClass };
}
