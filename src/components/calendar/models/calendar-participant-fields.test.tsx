/** Memory markup qualification only; browser focus/motion remains a separate release gate. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarParticipantFields } from '../components/calendar-participant-fields';
import type { CalendarParticipantView } from '../../../calendar/contracts';
const ref = { kind: 'guardian-user' as const, userId: 'private-account-reference' };
const person: CalendarParticipantView = { ref, availability: 'available', name: 'SYNTHETIC_PRIVATE_NAME' };
const common = { value: [ref], directory: { items: [person], truncated: false, nextAfter: null }, accepted: [person], search: '', onChange() {}, onSearchChange() {} };
test('authorized retained participant displays a real name without exposing account IDs or pretending invitations were sent', () => {
  const html = renderToStaticMarkup(<CalendarParticipantFields {...common} status="ready" />);
  expect(html).toContain(person.name); expect(html).toContain('Remove SYNTHETIC_PRIVATE_NAME');
  expect(html).not.toContain(ref.userId); expect(html).toContain('neither sends an invitation nor grants calendar access');
});
for (const status of ['idle', 'loading', 'error'] as const) test(`${status} masks old accepted and directory names and removal actions`, () => {
  const html = renderToStaticMarkup(<CalendarParticipantFields {...common} status={status} onRetry={() => {}} />);
  expect(html).not.toContain(person.name); expect(html).not.toContain(ref.userId); expect(html).not.toContain('Remove ');
  if (status === 'error') expect(html).toContain('Retry participants');
});
test('unavailable retained identity can be removed but never falls back to its ID or former name', () => {
  const html = renderToStaticMarkup(<CalendarParticipantFields {...common} directory={{ items: [], truncated: false, nextAfter: null }}
    accepted={[{ ref, availability: 'unavailable' }]} status="ready" />);
  expect(html).toContain('Remove Unavailable participant 1'); expect(html).not.toContain(ref.userId); expect(html).not.toContain(person.name);
});
test('a selected ref absent from this page is not falsely claimed unavailable and carries no old picker name', () => {
  const html = renderToStaticMarkup(<CalendarParticipantFields {...common} accepted={[]} directory={{ items: [], truncated: false, nextAfter: null }} status="ready" />);
  expect(html).toContain('Selected account (not on this page)'); expect(html).not.toContain('Unavailable participant');
  expect(html).not.toContain(ref.userId); expect(html).not.toContain(person.name);
});
test('a current unavailable binding masks an independently lagging directory name', () => {
  const html = renderToStaticMarkup(<CalendarParticipantFields {...common} accepted={[{ ref, availability: 'unavailable' }]} status="ready" />);
  expect(html).toContain('Unavailable participant'); expect(html).not.toContain(person.name); expect(html).not.toContain(ref.userId);
});
