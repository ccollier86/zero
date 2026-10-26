/** Optional managed blog author foundation, separate from the presentation-only component entry. */
export type * from './types';
export { resolveBlogConfig } from './config';
export { BLOG_API } from './contracts';
export { runBlogActorIfRequested } from './content-actor-bootstrap';
export type { BlogContentConfig } from './content-config';
export type * from './content-types';
export type * from './media-types';
export type * from './metrics-types';
