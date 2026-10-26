/** SSR controller for the managed public reader. Resolves live publications/SEO, never draft content or private account details. */
import { AuthError } from '../auth/types';
import { renderServerPage } from '../frontend/server/server-page-renderer';
import type { ZeroPluginSetupContext } from '../frontend/server/server-extensions';
import type { PageMeta } from '../frontend/router/types';
import type { BlogService } from './service';
import type { ResolvedBlogConfig } from './types';
import type { BlogPage, BlogTaxonomyTerm } from './content-types';
import { readBlogQuery } from './http-input';
import { presentPublishedBlogPost, blogPublicMediaHref } from './presentation';
import { BlogPublicPage } from '../components/blog/blog-public-page';
import type { BlogPublicPageModel } from './public-page-model';
import { BLOG_PAGES_PLUGIN } from './public-pages-plugin';

/** No Host-derived canonical URL, raw HTML, inline executable data or implicit auth-provider boot. */
export async function renderBlogPublicPage(request: Request, service: BlogService, config: ResolvedBlogConfig, context: ZeroPluginSetupContext): Promise<Response> {
  const url = new URL(request.url), site = service.publicSite('blog'), basePath = config.basePath;
  const articleSlug = url.pathname === basePath ? null : decodeURIComponent(url.pathname.slice(basePath.length + 1));
  const values = readBlogQuery(request, articleSlug ? [] : ['search', 'category', 'tag', 'page']);
  if (values.page !== undefined && (typeof values.page !== 'string' || !/^[1-9][0-9]{0,4}$/.test(values.page))) throw new AuthError('Invalid article page.', 'BLOG_INVALID_INPUT', 422);
  const query = { search: String(values.search ?? ''), category: values.category ? String(values.category) : null, tag: values.tag ? String(values.tag) : null, page: Number(values.page ?? 1) };
  const archive = query.category || query.tag ? await service.publishing.publicTerm(site.slug, (query.category ?? query.tag)!, request.signal) : null;
  if (archive && archive.kind !== (query.category ? 'category' : 'tag')) throw new AuthError('Archive not found.', 'BLOG_TAXONOMY_NOT_FOUND', 404);
  const post = articleSlug ? await service.publishing.publicPost(site.slug, articleSlug, request.signal) : null;
  if (post?.redirectTo) return new Response(null, { status: 308, headers: { Location: basePath + '/' + encodeURIComponent(post.redirectTo), 'Cache-Control': 'no-store' } });
  const pageSize = 12, posts = await service.publishing.publicPosts(site.slug, post ? { limit: 3 } : { search: query.search || undefined, categoryId: query.category ?? undefined, tagId: query.tag ?? undefined, limit: pageSize, offset: (query.page - 1) * pageSize, order: query.search ? 'relevance' : 'recent' }, request.signal);
  if (!post && query.page > 1 && !posts.items.length) throw new AuthError('Article page not found.', 'BLOG_POST_NOT_FOUND', 404);
  const terms = [...(await service.publishing.publicTerms(site.slug, { limit: 100 }, request.signal) as BlogPage<BlogTaxonomyTerm>).items];
  const requiredTerms = new Set(post ? [...post.content.categoryIds, ...post.content.tagIds] : posts.items.flatMap(item => [...item.categoryIds, ...item.tagIds]));
  const missingTerms = [...requiredTerms].filter(id => !terms.some(term => term.id === id));
  for (let offset = 0; offset < missingTerms.length; offset += 100) terms.push(...await service.publishing.publicTermsById(site.slug, missingTerms.slice(offset, offset + 100), request.signal));
  const presentation = (value: Parameters<typeof presentPublishedBlogPost>[0]) => presentPublishedBlogPost(value, { site: site.slug, basePath, terms, author: service.publicAuthorById(site.slug, value.author.id) });
  const article = post ? presentation(post) : null;
  const origin = context.seo?.siteUrl ?? context.appIdentity.publicUrl;
  const archiveQuery = new URLSearchParams(); if (query.category) archiveQuery.set('category', query.category); if (query.tag) archiveQuery.set('tag', query.tag); if (query.page > 1) archiveQuery.set('page', String(query.page));
  const canonical = origin && !query.search ? origin.replace(/\/$/, '') + (post ? basePath + '/' + post.content.slug : basePath + (archiveQuery.size ? '?' + archiveQuery : '')) : undefined;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const props: BlogPublicPageModel = { version: 1, nonce, site: site.slug, basePath, siteName: site.name, title: archive?.name, description: archive?.description, canonical, categories: terms.filter(term => term.kind === 'category').slice(0, 100).map(term => ({ id: term.id, name: term.name, slug: term.slug })),
    posts: posts.items.filter(value => value.id !== post?.id).map(presentation), article, query, pageSize, total: posts.total, metricsEnabled: service.publishing.publicMetricsEnabled };
  const image = post?.content.seo.socialImage ?? post?.content.featuredImage;
  const imageUrl = post && image && origin ? origin.replace(/\/$/, '') + blogPublicMediaHref(site.slug, post.content.slug, image.mediaId) : undefined;
  const title = post?.content.seo.title ?? post?.content.title ?? archive?.seoTitle ?? (archive ? archive.name + ' · ' + site.name : site.name), description = post?.content.seo.description ?? post?.content.excerpt ?? archive?.seoDescription ?? archive?.description;
  const meta: PageMeta = { title, description, ...(canonical ? { canonical } : {}),
    robots: { index: !(post?.content.seo.noIndex || query.search || archive?.noIndex || query.category && query.tag), follow: true },
    openGraph: { type: post ? 'article' : 'website', title, description, siteName: site.name, ...(canonical ? { url: canonical } : {}), ...(imageUrl ? { images: [{ url: imageUrl, alt: image!.alt }] } : {}) },
    twitter: { card: imageUrl ? 'summary_large_image' : 'summary' },
    ...(post && canonical ? { jsonLd: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.content.title, description: post.content.excerpt,
      datePublished: new Date(post.publishedAt).toISOString(), dateModified: new Date(post.updatedAt).toISOString(), author: { '@type': 'Person', name: article!.author!.name }, url: canonical, ...(imageUrl ? { image: imageUrl } : {}) } } : {}),
  };
  const response = await renderServerPage({ component: BlogPublicPage, props, request: request.method === 'HEAD' ? new Request(request, { method: 'GET' }) : request, appDir: context.appDir, frontend: context.frontend, pluginName: BLOG_PAGES_PLUGIN,
    rootId: 'zero-blog-public-root', nonce, meta, seo: context.seo, emitCode: context.emitCode });
  const bytes = await boundedHtml(response, request.signal);
  if (post) {
    const current = await service.publishing.publicPost(site.slug, post.content.slug, request.signal);
    if (current.id !== post.id || current.publicRevision !== post.publicRevision) throw new AuthError('The article changed. Reload to read its current publication.', 'BLOG_PUBLICATION_CHANGED', 409);
  } else service.publicSite(site.slug);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store'); headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'same-origin');
  headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; media-src 'self'; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`);
  return new Response(request.method === 'HEAD' ? null : bytes, { status: response.status, headers });
}
async function boundedHtml(response: Response, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted(); if (part.done) break; size += part.value.byteLength;
      if (size > 4 * 1024 * 1024) throw new AuthError('Article rendering capacity was exceeded.', 'BLOG_CAPACITY', 503); chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
