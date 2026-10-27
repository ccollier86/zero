/** Closed attachment declarations. Declared names/types are presentation metadata, not a malware or file-content verdict. */
import { MESSAGING_ATTACHMENT_MIMES, type MessagingAttachmentInput } from './attachment-contracts';
import { messagingChoice, messagingFail, messagingInteger, messagingRecord, messagingText } from './validation';
/** Reject active web formats and ambiguous lengths before opening Storage or allocating a stage. */
export function captureMessagingAttachment(input: unknown, maximum: number): Required<MessagingAttachmentInput> {
  const r = messagingRecord(input, ['fileName', 'mimeType', 'sizeBytes', 'checksum', 'visibility']);
  const fileName = messagingText(r.fileName, 180);
  if (/[/\\\p{Cc}\p{Cs}]/u.test(fileName) || fileName === '.' || fileName === '..' || fileName.trim() !== fileName
    || typeof r.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(r.checksum)) messagingFail('MESSAGING_INPUT_INVALID', 422);
  return { fileName, mimeType: messagingChoice(r.mimeType, MESSAGING_ATTACHMENT_MIMES), sizeBytes: messagingInteger(r.sizeBytes, 1, maximum),
    checksum: r.checksum as string, visibility: messagingChoice(r.visibility ?? 'conversation', ['conversation', 'staff']) };
}
