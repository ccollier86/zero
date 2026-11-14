import { expect, test } from 'bun:test';
import { demoCalendars } from '../test-support/demo-calendars';
import { emptyPracticeFilters, practiceFilterModel as projectPractice } from './practice-filter-model';
import { eventLocation, practiceGeography, practiceLocations, practicePreviewScopes } from '../test-support/practice-data';
import { newDraft } from './calendar-model';

const practiceFilterModel = (resources: Parameters<typeof projectPractice>[0], filters: Parameters<typeof projectPractice>[1], locations: readonly string[]) => projectPractice(resources, filters, locations, practiceGeography);
const all = practiceLocations.map(location => location.id);
test('full practice UI contains four states, seven locations and fifteen unique providers', () => {
  const model = practiceFilterModel(demoCalendars, emptyPracticeFilters(), all);
  expect(model.states).toHaveLength(4); expect(model.locations).toHaveLength(7); expect(model.providers).toHaveLength(15);
  expect(model.summary).toBe('All practice locations');
});
test('state filters use provider coverage, without duplicating multi-location providers', () => {
  const model = practiceFilterModel(demoCalendars, { ...emptyPracticeFilters(), states: ['IN'] }, all);
  expect(model.locations).toHaveLength(4); expect(model.providers).toHaveLength(10);
  expect(model.providers.some(provider => provider.id === 'user-1')).toBe(true);
  expect(model.providers.some(provider => provider.id === 'user-3')).toBe(false);
  const multiple = practiceFilterModel(demoCalendars, { ...emptyPracticeFilters(), states: ['IN', 'KY'] }, all);
  expect(multiple.providers.filter(provider => provider.id === 'user-1')).toHaveLength(1);
});
test('one specific office narrows the provider roster', () => {
  const model = practiceFilterModel(demoCalendars, { ...emptyPracticeFilters(), locations: ['in-greenwood'] }, all);
  expect(model.locations).toHaveLength(1); expect(model.providers).toHaveLength(5);
  expect(model.summary).toBe('Greenwood, IN');
});
test('a restricted visual preset never offers states or locations outside its supplied scope', () => {
  const indiana = practicePreviewScopes.find(scope => scope.id === 'indiana')!;
  const model = practiceFilterModel(demoCalendars, { ...emptyPracticeFilters(), states: ['GA'], locations: ['ga-alpharetta'] }, indiana.locations);
  expect(model.states.map(state => state.id)).toEqual(['IN']);
  expect(model.locations).toHaveLength(4);
  const fixed = practiceFilterModel(demoCalendars, emptyPracticeFilters(), ['in-greenwood']);
  expect(fixed.locationOptions).toHaveLength(1); expect(fixed.states).toHaveLength(1);
});
test('provider search finds roster rows without changing the geographical calendar scope', () => {
  const model = practiceFilterModel(demoCalendars, { ...emptyPracticeFilters(), query: 'EMILY' }, all);
  expect(model.foundProviders.map(provider => provider.id)).toEqual(['user-3']); expect(model.providers).toHaveLength(15);
  expect(practiceFilterModel(demoCalendars, { ...emptyPracticeFilters(), query: 'no-such-provider' }, all).foundProviders).toHaveLength(0);
});
test('empty supplied scope cannot accidentally broaden to the whole practice', () => {
  const model = practiceFilterModel(demoCalendars, emptyPracticeFilters(), []);
  expect(model.providers).toHaveLength(0); expect(model.states).toHaveLength(0); expect(model.locations).toHaveLength(0);
});
test('slot office context is preserved and provider-wide blocks do not acquire an office', () => {
  const slot = { resourceId: 'user-1', date: '2026-11-10', minute: 540, siteId: 'ga-alpharetta' };
  expect(newDraft(slot, 'appointment').siteId).toBe('ga-alpharetta');
  expect(eventLocation({ ...newDraft(slot, 'block'), id: 'block' })).toBeNull();
});
