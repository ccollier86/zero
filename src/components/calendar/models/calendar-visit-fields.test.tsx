/** Memory markup only; not real-browser or animation qualification. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarVisitFields } from '../components/calendar-visit-fields';
const location = { id: 'place', revision: 2, label: 'PRIVATE_SYNTHETIC_PLACE', region: 'US-IN', active: true };
test('unspecified is an explicit default rather than inferred telehealth or a location', () => {
  const html = renderToStaticMarkup(<CalendarVisitFields value={{}} locations={null} status="idle" onChange={() => {}} />);
  expect(html).toContain('Unspecified'); expect(html).not.toContain('PRIVATE_SYNTHETIC_PLACE'); expect(html).not.toContain('Loading currently');
});
test('denied/unavailable location choices do not render the old private page or selected label', () => {
  const html = renderToStaticMarkup(<CalendarVisitFields value={{ visitMode: 'in-person', visitLocation: location }}
    locations={{ items: [location], truncated: false, nextAfter: null }} status="error" onChange={() => {}} onRetry={() => {}} />);
  expect(html).not.toContain(location.label); expect(html).not.toContain('US-IN');
  expect(html).toContain('Location choices are unavailable'); expect(html).toContain('Retry locations');
});
test('an authorized empty page and historical selected version are distinct; neither silently changes the draft', () => {
  const html = renderToStaticMarkup(<CalendarVisitFields value={{ visitMode: 'in-person', visitLocation: location }}
    acceptedLocation={location} locations={{ items: [], truncated: false, nextAfter: null }} status="ready" onChange={() => { throw new Error('Rendering cannot change a draft.'); }} />);
  expect(html).toContain('No active locations on this page'); expect(html).toContain('accepted version'); expect(html).toContain(location.label);
});
test('an unaccepted draft choice is masked after a live authorized page no longer supplies it', () => {
  const html = renderToStaticMarkup(<CalendarVisitFields value={{ visitMode: 'in-person', visitLocation: location }}
    locations={{ items: [], truncated: false, nextAfter: null }} status="ready" onChange={() => {}} />);
  expect(html).not.toContain(location.label); expect(html).not.toContain('US-IN'); expect(html).toContain('Choose a current location before saving');
});
test('remote visit fields do not display stale physical location details or invent a provider connection', () => {
  const html = renderToStaticMarkup(<CalendarVisitFields value={{ visitMode: 'video', visitLocation: location }}
    locations={{ items: [location], truncated: true, nextAfter: 'more' }} status="ready" onChange={() => {}} />);
  expect(html).toContain('No call link, provider connection or notification'); expect(html).not.toContain(location.label);
  expect(html).not.toContain('Next locations');
});
