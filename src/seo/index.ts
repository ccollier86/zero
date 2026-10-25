/** Public, browser-safe metadata primitives; managed service setup lives in the server entry. */
export type { PageMetadata, SeoConfig, SeoImage, OpenGraphMeta, TwitterMeta, RobotsMeta, RobotsTxtRule, SeoJson, SeoDocument, SeoRenderContext } from './types';
export { mergePageMetadata, renderSeoMetadata, renderRobots } from './metadata';
export { SeoError } from './validation';
