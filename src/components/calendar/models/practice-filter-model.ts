import type { CalendarGeography } from './calendar-geography';
import type { CalendarResource } from '../types';

export interface PracticeFilters { states: string[]; locations: string[]; query: string }
export const emptyPracticeFilters = (): PracticeFilters => ({ states: [], locations: [], query: '' });
/** UI-only projection. An empty facet means all choices within the supplied demo scope. */
export function practiceFilterModel(resources: readonly CalendarResource[], filters: PracticeFilters, suppliedLocations: readonly string[], geography: CalendarGeography) {
  const { locations: practiceLocations, states: practiceStates, locationsForResource: providerLocations } = geography;
  const allowed = practiceLocations.filter(location => suppliedLocations.includes(location.id));
  const states = practiceStates.filter(state => allowed.some(location => location.state === state.id));
  const selectedStates = filters.states.filter(id => states.some(state => state.id === id));
  const locationOptions = allowed.filter(location => !selectedStates.length || selectedStates.includes(location.state));
  const selectedLocations = filters.locations.filter(id => locationOptions.some(location => location.id === id));
  const locations = locationOptions.filter(location => !selectedLocations.length || selectedLocations.includes(location.id));
  const ids = new Set(locations.map(location => location.id));
  const providers = resources.filter(resource => providerLocations(resource.id).some(id => ids.has(id)));
  const query = filters.query.trim().toLocaleLowerCase();
  const foundProviders = providers.filter(resource => resource.name.toLocaleLowerCase().includes(query));
  function providerSummary(resourceId: string) {
    const sites = locations.filter(location => providerLocations(resourceId).includes(location.id));
    if (sites.length === 1) return `${sites[0]!.name}, ${sites[0]!.state}`;
    return sites.length === allowed.length && allowed.length > 1 ? 'All locations' : `${sites.length} locations · ${[...new Set(sites.map(location => location.state))].join(', ')}`;
  }
  const summary = !allowed.length ? 'No locations available' : selectedLocations.length === 1 ? `${locations[0]!.name}, ${locations[0]!.state}`
    : selectedLocations.length > 1 ? `${locations.length} locations`
    : selectedStates.length === 1 ? `${states.find(state => state.id === selectedStates[0])!.name} · ${locations.length} ${locations.length === 1 ? 'location' : 'locations'}`
    : selectedStates.length > 1 ? `${selectedStates.length} states · ${locations.length} locations`
    : allowed.length === practiceLocations.length ? 'All practice locations'
    : allowed.length === 1 ? `${allowed[0]!.name}, ${allowed[0]!.state}` : `${states.map(state => state.name).join(', ')} · ${allowed.length} locations`;
  return { allowed, states, selectedStates, selectedLocations, locationOptions, locations, providers, foundProviders, providerSummary, summary };
}
/** Fully controlled sidebar state; callers own data fetching, scope and permissions. */
export type CalendarSidebarScope = ReturnType<typeof practiceFilterModel> & {
  filters: PracticeFilters;
  setStates(ids: string[]): void; setLocations(ids: string[]): void; setQuery(query: string): void;
  reset(): void; resetGeography(): void;
};
