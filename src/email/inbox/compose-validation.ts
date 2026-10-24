import { EmailError } from '../email-error';
import type { EmailComposeValue } from './contracts';

export function validateCompose(value: unknown, sending = false): EmailComposeValue {
  const bad = () => { throw new EmailError('Message fields or attachments are invalid.', 'EMAIL_INBOX_INPUT_INVALID', 400); };
  if (!value || typeof value !== 'object') return bad();
  const input = value as EmailComposeValue;
  const header = (item: unknown, max: number) => typeof item === 'string' && item.length <= max && !/[\x00\r\n]/.test(item);
  if (!header(input.from, 160) || !header(input.subject, 998) || typeof input.text !== 'string' || input.text.length > 1_000_000
    || (input.html !== undefined && (typeof input.html !== 'string' || input.html.length > 1_000_000))) return bad();
  for (const group of [input.to, input.cc, input.bcc]) {
    if (!Array.isArray(group) || group.length > 100 || !group.every(item => header(item, 320) && /^[^<>\s@,;]+@[^<>\s@,;]+\.[^<>\s@,;]+$/.test(item))) return bad();
  }
  if (input.recipientDrafts !== undefined && (!input.recipientDrafts || typeof input.recipientDrafts !== 'object' || Object.entries(input.recipientDrafts).some(([key, value]) => !['to', 'cc', 'bcc'].includes(key) || typeof value !== 'string' || value.length > 32000 || value.includes('\x00') || sending && !!value.trim()))) return bad();
  if (sending && (!input.to.length || !input.subject.trim() || (!input.text.trim() && !input.html?.trim()))) return bad();
  if (input.inReplyTo !== undefined && !header(input.inReplyTo, 998)) return bad();
  if (input.references !== undefined && !header(input.references, 20_000)) return bad();
  if (!Array.isArray(input.attachments) || input.attachments.length > 20) return bad();
  let bytes = 0;
  for (const file of input.attachments) {
    if (!file || !header(file.filename, 255) || !header(file.contentType, 160) || !header(file.id, 160)
      || typeof file.base64 !== 'string' || file.base64.length > 14 * 1024 * 1024 || !validBase64(file.base64)
      || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 10 * 1024 * 1024
      || (file.contentId !== undefined && !header(file.contentId, 998))) return bad();
    const actual = file.base64.length / 4 * 3 - (file.base64.endsWith('==') ? 2 : file.base64.endsWith('=') ? 1 : 0);
    if (actual !== file.size || (bytes += actual) > 15 * 1024 * 1024) return bad();
  }
  return structuredClone(input);
}

/** Linear scan, including large attachments; no repeated regex groups/backtracking. */
function validBase64(value: string): boolean {
  if (value.length % 4) return false;
  const pad = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  for (let index = 0; index < value.length - pad; index++) {
    const char = value.charCodeAt(index);
    if (!(char >= 65 && char <= 90 || char >= 97 && char <= 122 || char >= 48 && char <= 57 || char === 43 || char === 47)) return false;
  }
  return true;
}

export function validateInboxId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new EmailError('A valid operation or draft ID is required.', 'EMAIL_INBOX_INPUT_INVALID', 400);
  return value;
}
