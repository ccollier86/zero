/** Configuration evidence only. Never opens a domain, provisions metadata, starts an actor or claims runtime health. */
import type { ResolvedConfig } from '../frontend/server/types';
import type { PlatformDoctorFindingSink } from './platform-doctor-contracts';
export function checkCalendar(config: Pick<ResolvedConfig, 'calendar'>, findings: PlatformDoctorFindingSink): void {
  if (!config.calendar) return;
  const docs = './docs-next/backend/calendar/index.md';
  if (config.calendar.readiness !== 'configured') findings.push({ severity: 'warning', code: 'calendar.setup.timezone_required', path: 'calendar.timezone', docs,
    message: 'Calendar scheduling timezone setup is incomplete.',
    hint: 'Choose an explicit IANA scheduling timezone. The host, browser and display timezone do not configure booking authority.' });
  findings.push({ severity: 'info', code: 'calendar.core.configured', path: 'calendar', docs,
    message: 'Calendar is declared for private one-off scheduling with Guardian and Fabric.',
    hint: 'This is configuration evidence only, not actor/storage readiness. Qualify the matching installed archive; availability rules, recurrence, participants, reminders and self-booking are not provided by this core.' });
}
