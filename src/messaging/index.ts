/** Server composition/public typed facade; importing this module does not boot an application or worker. */
export { runMessagingActorIfRequested, MESSAGING_ACTOR_FLAG } from './actor-bootstrap';
export { MessagingService } from './service';
export type { MessagingAuthority } from './service';
export type { MessagingConfig } from './config';
export type * from './contracts';
export type * from './attachment-contracts';
export type * from './review-contracts';
export type { MessagingServerApi } from './server-contracts';
