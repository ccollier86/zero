/** Optional complete email workspace and reusable parts. Server providers remain at /email. */
export { EmailInbox, EmailInboxWorkspace, type EmailInboxProps, type EmailInboxWorkspaceProps } from './email-inbox';
export { EmailInboxController, initialEmailInboxState, type EmailInboxState, type EmailInboxDraftState, type EmailInboxControllerOptions } from './email-inbox-controller';
export { useEmailInbox, type UseEmailInboxOptions } from './use-email-inbox';
export { EmailComposer, EmailRecipientField, type EmailRecipientFieldProps } from './email-composer';
export { EmailFolderNav, EmailMailboxSwitcher, EmailMessageList, EmailMessageRow, EmailHeaders, EmailReader, EmailAttachments } from './email-inbox-parts';
export { EmailHtmlBody, EmailPlainTextBody, type EmailHtmlBodyProps } from './html/email-html-body';
export { createEmailInboxSource, EmailInboxRequestError } from '../../frontend/client/email-inbox-source';
export type * from '../../email/inbox/contracts';
export { EMAIL_INBOX_API, EMAIL_DRAFT_FOLDER, emailMessageKey, emptyEmailCompose } from '../../email/inbox/contracts';
