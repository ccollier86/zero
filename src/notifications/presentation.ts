/** Content-free alert routing, not membership, authorization, delivery or a read receipt. */
export interface NotificationChatPresentation {
  readonly kind: 'chat';
  readonly conversationId: string;
  readonly messageId: string;
}
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
export function isNotificationChatPresentation(value: unknown): value is NotificationChatPresentation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).length === 3 && r.kind === 'chat'
    && typeof r.conversationId === 'string' && id.test(r.conversationId)
    && typeof r.messageId === 'string' && id.test(r.messageId);
}
export function notificationChatPresentation(metadata: string | null): NotificationChatPresentation | null {
  if (!metadata || metadata.length > 2048) return null;
  try {
    const r = JSON.parse(metadata)?.zero;
    if (!r || r.version !== 1) return null;
    const { version: _, ...presentation } = r;
    return isNotificationChatPresentation(presentation) ? presentation : null;
  } catch { return null; }
}
