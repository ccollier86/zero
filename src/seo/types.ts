/** Shared typed metadata for file pages, server-rendered plugin pages and app defaults. */
export interface SeoImage { url: string; alt?: string; width?: number; height?: number; type?: string }
export interface OpenGraphMeta {
  title?: string; description?: string; url?: string; type?: string;
  siteName?: string; locale?: string; images?: readonly (string | SeoImage)[];
}
export interface TwitterMeta {
  card?: 'summary' | 'summary_large_image'; site?: string; creator?: string;
  title?: string; description?: string; images?: readonly (string | SeoImage)[];
}
export interface RobotsMeta {
  index?: boolean; follow?: boolean; noarchive?: boolean; nosnippet?: boolean;
  maxSnippet?: number; maxVideoPreview?: number; maxImagePreview?: 'none' | 'standard' | 'large';
}
export type SeoJson = null | boolean | number | string | readonly SeoJson[] | { readonly [key: string]: SeoJson };
export interface PageMetadata {
  title?: string; description?: string;
  /** Absolute HTTP(S) or site-relative URL; false suppresses the canonical link. */
  canonical?: string | false;
  openGraph?: OpenGraphMeta | false;
  twitter?: TwitterMeta | false;
  robots?: RobotsMeta;
  /** JSON data only, never raw HTML or pre-serialized script markup. */
  jsonLd?: SeoJson | readonly SeoJson[];
  alternates?: { languages: Readonly<Record<string, string>> };
}
export interface RobotsTxtRule {
  userAgent: string | readonly string[];
  allow?: string | readonly string[];
  disallow?: string | readonly string[];
}
export interface SeoConfig extends PageMetadata {
  /** Applied to a page title using exactly one %s placeholder. */
  titleTemplate?: string;
  /** false forces noindex,nofollow, even if page metadata requests indexing. */
  indexing?: boolean;
  /** Opted-in SEO serves /robots.txt by default; false leaves ownership to the app. */
  robotsTxt?: boolean | { rules?: readonly RobotsTxtRule[]; sitemaps?: readonly string[] };
}
export interface SeoRenderContext {
  requestUrl: string;
  /** Trusted app configuration, never derived from forwarded/Host headers. */
  siteUrl?: string;
  defaults?: SeoConfig | false;
  nonce?: string;
  status?: number;
  /** Auth-protected pages cannot opt themselves into indexing. */
  indexable?: boolean;
}
export interface SeoDocument {
  head: string;
  canonical?: string;
  robots: string;
  indexable: boolean;
  headers: Readonly<Record<string, string>>;
}
