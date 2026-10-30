/** Honest display language. Labels never rewrite signed events or turn preparation into proof of human attention. */
import type { LoggingEvent } from '../../logging/logging-contracts';
import type { LoggingTableChoice } from '../../logging/logging-directory-contracts';
export interface LoggingActivityLabel { readonly label: string; readonly description?: string }
export interface LoggingPresentation {
  readonly actions?: Readonly<Record<string, LoggingActivityLabel>>;
  /** Keys can be an exact retained table target (table.patient-records) or its configured name. */
  readonly tables?: Readonly<Record<string, string>>;
  readonly resources?: Readonly<Record<string, string>>;
}
export const LOGGING_ACTIVITY_LABELS: Readonly<Record<string, LoggingActivityLabel>> = Object.freeze({
  'record.created': { label: 'Created a record', description: 'The database committed a new record.' },
  'record.updated': { label: 'Edited a record', description: 'The database committed changes to a record.' },
  'record.deleted': { label: 'Deleted a record', description: 'The database committed the removal of a record.' },
  'record.read': { label: 'Record read', description: 'The application recorded this read stage.' },
  'record.viewed': { label: 'Viewed a record', description: 'The browser reported displaying an authorized result. Foreground time is observed, not proof of attention.' },
  'record.list.viewed': { label: 'Viewed a list of records', description: 'The browser reported displaying this ordered result. Inspect its recorded identities and display revisions.' },
  'view.record': { label: 'Viewed an item', description: 'The application bound this browser view to an item. No server-issued result receipt was attached.' },
  'record.read.admitted': { label: 'Requested a record', description: 'The read was admitted; its result had not been prepared yet.' },
  'record.read.prepared': { label: 'Prepared a record for viewing', description: 'The server prepared the result; this does not prove someone viewed it.' },
  'record.list.prepared': { label: 'Returned a list of records', description: 'The server prepared this ordered result; this does not prove it was displayed.' },
  'record.read.failed': { label: 'Record could not be loaded' },
  'record.read.denied': { label: 'Record access was blocked' },
  'record.read.unknown': { label: 'Record read could not be confirmed' },
  'navigation.changed': { label: 'Navigated to a page', description: 'The browser reported a navigation.' },
  'view.opened': { label: 'Opened a view', description: 'The browser reported this view opening.' },
  'view.interval': { label: 'Time in a view', description: 'A browser observation, not proof of attention.' },
  'view.closed': { label: 'Left a view' },
  'clipboard.copy.observed': { label: 'Copy action observed', description: 'A copy signal was observed; clipboard contents were not collected.' },
  'clipboard.copy.completed': { label: 'Copy operation completed', description: 'The browser reported completion of the copy operation.' },
  'clipboard.copy.failed': { label: 'Copy operation failed' },
  'print.requested': { label: 'Requested printing', description: 'The browser reported a print request. This does not prove anything was printed on paper.' },
  'print.dialog.closed': { label: 'Closed the print dialog', description: 'Printing or cancellation cannot be inferred from this signal.' },
  'logging.query.window': { label: 'Reviewed activity logs', description: 'An authorized investigation window was opened.' },
  'logging.query.denied': { label: 'Activity log access was blocked' },
  'identity.registered': { label: 'Created an account' },
  'identity.provisioned-by-admin': { label: 'Administrator created an account' },
  'session.tenant-selected': { label: 'Selected an organization' },
  'session.tenant-switched': { label: 'Switched organizations' },
  'session.scope-switched': { label: 'Changed session scope' },
  'session.revoked': { label: 'Revoked a session' },
  'account.sessions-revoked': { label: 'Revoked account sessions' },
});
const own = <T,>(map: Readonly<Record<string, T>> | undefined, code: string): T | undefined => map && Object.hasOwn(map, code) ? map[code] : undefined;
export function loggingWords(code: string): string {
  const words = code.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[._:-]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Activity';
}
export function loggingActivity(event: LoggingEvent, presentation?: LoggingPresentation): LoggingActivityLabel {
  if (event.action.startsWith('app.') && event.origin !== 'frontend' && typeof event.metadata.actionName === 'string'
    && event.metadata.actionName.length > 0 && event.metadata.actionName.length <= 120 && typeof event.metadata.actionVersion === 'string')
    return own(presentation?.actions, event.action) ?? { label: event.metadata.actionName };
  return loggingActivityCode(event.action, presentation);
}
export function loggingActivityCode(action: string, presentation?: LoggingPresentation): LoggingActivityLabel {
  return own(presentation?.actions, action) ?? own(LOGGING_ACTIVITY_LABELS, action) ?? { label: loggingWords(action) };
}
export function loggingTableLabel(table: LoggingTableChoice, presentation?: LoggingPresentation): string {
  return own(presentation?.tables, table.type) ?? (table.names.length === 1 ? own(presentation?.tables, table.names[0]!) : undefined)
    ?? table.label ?? table.names.map(loggingWords).join(' / ');
}
export function loggingResourceLabel(event: Pick<LoggingEvent, 'target'> & Partial<Pick<LoggingEvent, 'detail' | 'metadata'>>, tables: readonly LoggingTableChoice[], presentation?: LoggingPresentation): string {
  if (!event.target) return 'No specific record';
  if (event.target.type === 'page' && typeof event.metadata?.pageName === 'string') return event.metadata.pageName;
  const table = tables.find(table => table.type === event.target!.type);
  // Legacy slugs can group different physical names. A typed source fact
  // identifies its exact table; do not show a different table's current label.
  if (event.detail?.kind === 'record-change') {
    const name = event.detail.table;
    return own(presentation?.tables, name) ?? own(presentation?.tables, event.target.type)
      ?? (table?.names.length === 1 && table.names[0] === name ? table.label : undefined) ?? loggingWords(name);
  }
  return table ? loggingTableLabel(table, presentation) : own(presentation?.tables, event.target.type) ?? own(presentation?.resources, event.target.type)
    ?? (event.target.type.startsWith('table.') ? loggingWords(event.target.type.slice(6)) : loggingWords(event.target.type));
}
export const LOGGING_CATEGORY_LABELS = { operational: 'System diagnostics', security: 'Sign-in & security', records: 'Records', views: 'Viewing activity', clipboard: 'Copy activity', printing: 'Printing', transfers: 'Files & transfers', workflow: 'Workflows', communications: 'Messages & email', ai: 'AI activity', investigations: 'Audit reviews', navigation: 'Navigation' } as const;
