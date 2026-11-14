/** Caller-supplied UI choices. Visibility here is not a Guardian authorization decision. */
export interface CalendarLocation { id: string; name: string; state: string }
export interface CalendarRegion { id: string; name: string }
export interface CalendarGeography {
  locations: readonly CalendarLocation[];
  states: readonly CalendarRegion[];
  locationsForResource(resourceId: string): readonly string[];
}
