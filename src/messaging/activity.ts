import type { TypingIndicatorMember } from '../frontend/client/typing-indicator-model';
import type { MessagingActivity } from './presentation';

export interface ConversationActivityMember extends TypingIndicatorMember { activity: MessagingActivity }

export function conversationActivityMembers(members: readonly TypingIndicatorMember[]): ConversationActivityMember[] {
  return members.map(member => ({ ...member, activity: member.metadata?.activity === 'recording' ? 'recording' : member.metadata?.activity === 'uploading' ? 'uploading' : 'typing' }));
}
export function conversationActivityLabel(members: readonly ConversationActivityMember[], labelFor?: (id: string) => string | undefined): string {
  if (!members.length) return '';
  const labels = members.slice(0, 2).map(member => labelFor?.(member.userId) || member.label);
  const who = members.length === 1 ? labels[0] : members.length === 2 ? `${labels[0]} and ${labels[1]}` : `${labels[0]}, ${labels[1]} and ${members.length - 2} other${members.length === 3 ? '' : 's'}`;
  const activities = new Set(members.map(member => member.activity));
  const action = activities.size > 1 ? 'active in this conversation' : members[0]!.activity === 'recording' ? 'recording a voice message' : members[0]!.activity === 'uploading' ? 'uploading a file' : 'typing';
  return `${who} ${members.length === 1 ? 'is' : 'are'} ${action}${action === 'typing' ? '…' : '.'}`;
}
