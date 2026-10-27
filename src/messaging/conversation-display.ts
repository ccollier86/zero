/** Direct-list identity decoration is bounded to 50 people; group directories are explicit bounded reads. */
import type { ConversationRecord, MessagingDirectoryEntry } from './contracts';
export function directMessagingDisplay(records: readonly ConversationRecord[], resolve: (ids: readonly string[]) => readonly MessagingDirectoryEntry[]): readonly ConversationRecord[] {
  const ids = [...new Set(records.filter(row => row.kind === 'direct' && row.participants.length <= 2).flatMap(row => row.participants.filter(person => person.kind === 'user').map(person => person.id)))];
  const people = new Map(resolve(ids).map(row => [row.id, row]));
  return records.map(row => row.kind !== 'direct' ? row : { ...row, participants: row.participants.map(person => {
    const display = people.get(person.id); return display ? { ...person, name: display.name, avatarUrl: display.avatarUrl } : person;
  }) });
}
