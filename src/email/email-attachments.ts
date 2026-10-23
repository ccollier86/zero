/**
 * email-attachments.ts
 * Validates and copies bounded in-memory email attachments without fetching URLs, reading files, or logging their names or contents.
 */

import { EmailError } from './email-error';
import type { EmailAttachment, EmailProvider } from './types';

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const FILENAME_UNSAFE = /[\/\\:]|[\p{Cc}\p{Cf}]/u;
const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$%&'+.^_`|~-]*\/[A-Za-z0-9][A-Za-z0-9!#$%&'+.^_`|~-]*$/;
const ATTACHMENT_KEYS = new Set(['filename', 'content', 'contentType']);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;

/** Require an explicit provider capability and return owned bytes before crossing an asynchronous delivery boundary. */
export function prepareEmailAttachments(
  provider: Pick<EmailProvider, 'supportsAttachments'>,
  input: EmailAttachment[] | undefined,
): EmailAttachment[] | undefined {
  const attachments = copyEmailAttachments(input);
  if (attachments?.length && provider.supportsAttachments !== true) {
    throw new EmailError('The email provider does not support attachments', 'EMAIL_ATTACHMENTS_UNSUPPORTED', 400);
  }
  return attachments;
}

/** Strict scalars and non-shared byte views prevent implicit provider fetches, header injection, and later caller mutation. */
function copyEmailAttachments(input: EmailAttachment[] | undefined): EmailAttachment[] | undefined {
  if (input === undefined) return undefined;
  try {
    if (!Array.isArray(input)) throw invalid();
    const count = input.length;
    if (!Number.isInteger(count) || count < 0) throw invalid();
    if (count > MAX_ATTACHMENTS) throw limit();
    let totalBytes = 0;
    const result: EmailAttachment[] = [];
    for (let index = 0; index < count; index++) {
      const entry = input[index];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).some((key) => !ATTACHMENT_KEYS.has(key))) throw invalid();
      const { filename, content, contentType } = entry;
      if (typeof filename !== 'string' || filename.length < 1 || filename.length > 255
        || filename !== filename.trim() || filename === '.' || filename === '..' || FILENAME_UNSAFE.test(filename)) throw invalid();
      if (contentType !== undefined && (typeof contentType !== 'string' || contentType.length > 127 || !MEDIA_TYPE.test(contentType))) throw invalid();
      if (!(content instanceof Uint8Array)) throw invalid();
      // Intrinsic getters cannot be replaced by a caller's shadow byteLength/buffer properties.
      const byteLength = byteLengthOf.call(content) as number;
      const buffer = bufferOf.call(content) as ArrayBufferLike;
      if (byteLength < 1 || (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer)) throw invalid();
      totalBytes += byteLength;
      if (totalBytes > MAX_ATTACHMENT_BYTES) throw limit();
      result.push({ filename, content: new Uint8Array(content), ...(contentType === undefined ? {} : { contentType }) });
    }
    return result;
  } catch (error) {
    if (error instanceof EmailError) throw error;
    // Proxies, detached buffers, or throwing accessors must not expose their raw errors or partially constructed messages.
    throw invalid();
  }
}

/** Safe validation errors deliberately omit filenames, MIME values, attachment bytes, and supplied object details. */
function invalid(): EmailError {
  return new EmailError('Email attachments require safe filenames, media types, and nonempty byte content', 'EMAIL_ATTACHMENT_INVALID', 400);
}

/** The aggregate raw-byte cap leaves headroom for base64 expansion at the external provider boundary. */
function limit(): EmailError {
  return new EmailError('Email attachments exceed the count or total byte limit', 'EMAIL_ATTACHMENT_LIMIT_EXCEEDED', 413);
}
