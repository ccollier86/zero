/** One bounded, scope-local alert arbiter. Never writes notification/message receipts. */
import { notificationChatPresentation } from '../../notifications/presentation';
import type { Notification } from './notification-hooks';

export type NotificationSoundKind = 'chat' | 'notification';
type Alert = Pick<Notification, 'notification_id' | 'metadata' | 'expires_at'>;
interface Decision { allowed: boolean; sound: boolean; toast: boolean; kind: NotificationSoundKind }
export class NotificationFeedback {
  private readonly conversations = new Map<symbol, { id: string; active: () => boolean }>();
  private readonly decisions = new Map<string, Decision>();
  constructor(private readonly current: () => boolean, private readonly play: (kind: NotificationSoundKind) => void) {}
  registerConversation(id: string, active: () => boolean): () => void {
    const key = Symbol(); this.conversations.set(key, { id, active });
    return () => { this.conversations.delete(key); };
  }
  private decision(notification: Alert): Decision {
    const chat = notificationChatPresentation(notification.metadata);
    const key = chat ? JSON.stringify(['chat', chat.conversationId, chat.messageId]) : 'notice:' + notification.notification_id;
    const previous = this.decisions.get(key); if (previous) return previous;
    let active = false;
    if (chat) for (const entry of this.conversations.values()) {
      if (entry.id !== chat.conversationId) continue;
      try { if (entry.active()) { active = true; break; } } catch { /* An unavailable surface is not active. */ }
    }
    const value: Decision = { allowed: !active && (notification.expires_at === null || notification.expires_at > Date.now()),
      sound: false, toast: false, kind: chat ? 'chat' : 'notification' };
    this.decisions.set(key, value);
    if (this.decisions.size > 2048) this.decisions.delete(this.decisions.keys().next().value!);
    return value;
  }
  observe(notification: Alert): void {
    if (!this.current()) return;
    const decision = this.decision(notification);
    if (decision.sound) return;
    decision.sound = true; // No replay after unmute, unlock or leaving the active conversation.
    if (decision.allowed) this.play(decision.kind);
  }
  claimToast(notification: Alert): boolean {
    if (!this.current()) return false;
    const decision = this.decision(notification);
    if (decision.toast) return false;
    decision.toast = true;
    return decision.allowed;
  }
  /** Read the same suppression decision for an app-owned desktop alert; no receipt or sound side effect. */
  allowInterruption(notification: Alert): boolean { return this.current() && this.decision(notification).allowed; }
}

/** Selected is not sufficient: mobile list, background tabs and hidden/inert panes do not suppress alerts. */
export function isConversationSurfaceActive(element: HTMLElement | null): boolean {
  if (!element || !element.isConnected || document.visibilityState !== 'visible' || !document.hasFocus()
    || element.closest('[inert], [aria-hidden="true"]') || !element.getClientRects().length) return false;
  if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}
