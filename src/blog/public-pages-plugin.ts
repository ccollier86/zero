/** First-party blog page contribution. Build owns enhancement assets; live setup renders only accepted public snapshots. */
import { Elysia } from 'elysia';
import { defineZeroPlugin, type ZeroPluginSetupContext } from '../frontend/server/server-extensions';
import type { ResolvedBlogConfig } from './types';
import { contentHash } from './content-rows';
import { markPublicLoggingRequest } from '../logging/logging-public-request';
import { AuthError } from '../auth/types';
import { renderBlogPublicPage } from './public-pages-render';

export const BLOG_PAGES_PLUGIN = 'zero-blog-pages';
/** Normal build route-ownership admission refuses to overwrite an app-owned /blog tree. */
export function blogPagesPlugin(config: ResolvedBlogConfig) {
  return defineZeroPlugin({ name: BLOG_PAGES_PLUGIN,
    build: { required: true, mountPaths: [config.basePath], identity: contentHash({ version: 1, basePath: config.basePath, siteName: config.siteName }),
      prepare: () => ({ browserEntries: [{ name: 'blog-reader', path: new URL('./public-page-hydrate.tsx', import.meta.url) }],
        styleSources: [new URL('../components/blog/', import.meta.url)] }) },
    setup: context => setupBlogPages(context, config),
  });
}
function setupBlogPages(context: ZeroPluginSetupContext, config: ResolvedBlogConfig) {
  const service = () => { const blog = context.zero.blog; if (!blog) throw new AuthError('The blog is unavailable.', 'BLOG_NOT_READY', 503); return blog; };
  const unpublishSitemap = context.seo?.registerSitemap(BLOG_PAGES_PLUGIN, async () => {
    const entries: { href: string; lastmod?: string }[] = [{ href: config.basePath }]; let after: string | undefined;
    for (;;) {
      const page = await service().publishing.publicSitemap('blog', after);
      for (const post of page) entries.push({ href: config.basePath + '/' + post.slug, lastmod: new Date(post.updatedAt).toISOString() });
      if (entries.length > 50000) throw new AuthError('Blog sitemap capacity was exceeded.', 'BLOG_CAPACITY', 503);
      if (page.length < 500) break;
      after = page.at(-1)!.id;
    }
    after = undefined;
    for (;;) {
      const page = await service().publishing.publicTaxonomySitemap('blog', after);
      for (const term of page) entries.push({ href: config.basePath + '?' + new URLSearchParams({ [term.kind]: term.id }) });
      if (entries.length > 50000) throw new AuthError('Blog sitemap capacity was exceeded.', 'BLOG_CAPACITY', 503);
      if (page.length < 500) return entries;
      after = page.at(-1)!.id;
    }
  });
  const app = new Elysia({ name: BLOG_PAGES_PLUGIN })
    .onTransform(({ request }) => { markPublicLoggingRequest(request); })
    .onError(({ error, set }) => {
      const status = error instanceof AuthError ? error.status : 503;
      set.status = status; set.headers['Cache-Control'] = 'no-store'; set.headers['X-Robots-Tag'] = 'noindex, nofollow';
      return status === 404 ? 'Article not found.' : status < 500 ? 'The blog address is invalid.' : 'The blog is temporarily unavailable.';
    });
  const handle = (request: Request) => renderBlogPublicPage(request, service(), config, context);
  return app.get(config.basePath, ({ request }) => handle(request)).head(config.basePath, ({ request }) => handle(request))
    .get(config.basePath + '/:slug', ({ request }) => handle(request)).head(config.basePath + '/:slug', ({ request }) => handle(request))
    .onStop(() => { unpublishSitemap?.(); });
}
