/**
 * email-attachments.ts
 * Validates bounded in-memory attachments and snapshots their exact bytes before
 * a provider can observe them. It never reads paths, fetches URLs or logs data.
 */

import { EmailError } from './email-error';
import type { EmailAttachment, EmailProvider } from './types';

const MAX_ATTACHMENTS = 100;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const UNSAFE_FILENAME = /[\/\\:]|[\p{Cc}\p{Cf}]/u;
const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$%&'+.^_`|~-]*\/[A-Za-z0-9][A-Za-z0-9!#$%&'+.^_`|~-]*$/;
const KEYS = new Set(['filename', 'content', 'contentType', 'contentId']);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;

/** Internal marker prevents caller-thrown EmailErrors from bypassing sanitization. */
class AttachmentAdmissionError extends EmailError {}

/**
 * Admit at most 100 files / 25 MiB total raw bytes, retaining v2 inline and
 * zero-byte file support. A supplied provider must explicitly support files.
 */
export function prepareEmailAttachments(
  input: readonly EmailAttachment[] | undefined,
  provider?: Pick<EmailProvider, 'supportsAttachments'>,
): EmailAttachment[] | undefined {
  if (input === undefined) return undefined;
  try {
    if (!Array.isArray(input)) throw invalid();
    const count = input.length;
    if (!Number.isSafeInteger(count) || count < 0) throw invalid();
    if (count > MAX_ATTACHMENTS) throw limit();
    if (count && provider && provider.supportsAttachments !== true) {
      throw new AttachmentAdmissionError('The email provider does not support attachments', 'EMAIL_ATTACHMENTS_UNSUPPORTED', 400);
    }

    let bytes = 0;
    const attachments: EmailAttachment[] = [];
    for (let index = 0; index < count; index++) {
      const entry = input[index];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).some(key => !KEYS.has(key))) throw invalid();
      const { filename, content, contentType, contentId } = entry;
      if (typeof filename !== 'string' || !filename || filename.length > 255
        || filename !== filename.trim() || filename === '.' || filename === '..'
        || UNSAFE_FILENAME.test(filename)) throw invalid();
      if (contentType !== undefined && (typeof contentType !== 'string'
        || contentType.length > 127 || contentType !== contentType.trim() || !MEDIA_TYPE.test(contentType))) throw invalid();
      if (contentId !== undefined && (typeof contentId !== 'string'
        || !contentId || contentId.length > 998 || /[^\x21-\x7e]/.test(contentId))) throw invalid();
      if (!(content instanceof Uint8Array)) throw invalid();
      const byteLength = byteLengthOf.call(content) as number;
      const buffer = bufferOf.call(content) as ArrayBufferLike;
      if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) throw invalid();
      bytes += byteLength;
      if (bytes > MAX_ATTACHMENT_BYTES) throw limit();
      attachments.push({ filename, content: new Uint8Array(content),
        ...(contentType === undefined ? {} : { contentType }),
        ...(contentId === undefined ? {} : { contentId }),
      });
    }
    return attachments;
  } catch (error) {
    if (error instanceof AttachmentAdmissionError) throw error;
    // Accessors, proxies and detached views must not leak their raw errors.
    throw invalid();
  }
}

/** Validation errors contain no filenames, MIME values, contents or paths. */
function invalid(): EmailError {
  return new AttachmentAdmissionError('Email attachments require safe filenames, media types and byte content', 'EMAIL_ATTACHMENT_INVALID', 400);
}

/** Count/raw-byte bounds apply before transport encoding or network work. */
function limit(): EmailError {
  return new AttachmentAdmissionError('Email attachments exceed the count or total byte limit', 'EMAIL_ATTACHMENT_LIMIT_EXCEEDED', 413);
}
