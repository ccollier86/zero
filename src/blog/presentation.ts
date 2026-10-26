/** Browser-safe adapters from accepted publishing snapshots into the existing tokenized blog components. No private profile fallback. */
import type { BlogContentBlock, BlogPost, BlogImage, BlogAuthor } from '../components/blog/blog.types';
import type { BlogDocument, BlogImageReference, BlogPublishedPost, BlogPublishedSummary, BlogTaxonomyTerm } from './content-types';
import type { BlogPublicAuthor } from './types';
import { BLOG_API } from './contracts';

/** Public media URLs remain publication-bound; an asset ID alone is never sufficient for delivery. */
export function blogPublicMediaHref(site: string, slug: string, id: string): string {
  return `${BLOG_API}/public/${encodeURIComponent(site)}/posts/${encodeURIComponent(slug)}/media/${encodeURIComponent(id)}`;
}
/** Pure canonical-document projection, preserving all inline marks, alt text and stable heading IDs. */
export function presentBlogDocument(document: BlogDocument, mediaHref: (id: string) => string): BlogContentBlock[] {
  const image = (ref: BlogImageReference): BlogImage => ({ src: mediaHref(ref.mediaId), alt: ref.alt, ...(ref.caption ? { caption: ref.caption } : {}) });
  const text = (runs: readonly { text: string }[]) => runs.map(run => run.text).join('');
  return document.blocks.map(block => {
    switch (block.type) {
      case 'paragraph': return { id: block.id, type: 'paragraph', text: text(block.content), inline: block.content };
      case 'heading': return { id: block.id, type: 'heading', level: block.level, anchor: block.id, text: text(block.content), inline: block.content };
      case 'quote': return { id: block.id, type: 'quote', text: text(block.content), inline: block.content, author: block.attribution };
      case 'callout': return { id: block.id, type: 'callout', variant: block.tone, title: block.title, text: text(block.content), inline: block.content };
      case 'list': return { id: block.id, type: 'list', style: block.ordered ? 'numbered' : 'bullet', items: block.items.map(text), inlineItems: block.items };
      case 'image': return { id: block.id, type: 'image', ...image(block.image) };
      case 'gallery': return { id: block.id, type: 'image-gallery', images: block.images.map(image), layout: block.layout, columns: block.columns };
      case 'audio': return { id: block.id, type: 'audio', src: mediaHref(block.mediaId), title: block.title, artist: block.artist, coverArt: block.cover ? mediaHref(block.cover.mediaId) : undefined };
      case 'video': return { id: block.id, type: 'video', src: mediaHref(block.mediaId), title: block.title, poster: block.poster ? mediaHref(block.poster.mediaId) : undefined };
      case 'embed': return { ...block };
      case 'code': return { ...block };
      case 'divider': return { ...block };
    }
  });
}
/** Current public author fields are optional; an approved historical name remains safe when a profile is withdrawn. */
export function presentBlogAuthor(snapshot: { id: string; name: string }, current?: BlogPublicAuthor | null): BlogAuthor {
  return { id: snapshot.id, name: current?.name ?? snapshot.name, ...(current ? {
    avatar: current.avatar?.deliveryPath, bio: current.bio, role: current.byline,
    socialLinks: current.socialLinks.map((link, index) => ({ id: String(index), label: link.label, href: link.url })),
    ...(current.website ? { social: { website: current.website } } : {}),
  } : {}) };
}
/** Assemble the default article/list model without exposing draft data or Storage capabilities. */
export function presentPublishedBlogPost(post: BlogPublishedPost | BlogPublishedSummary, options: { site: string; basePath: string; terms?: readonly BlogTaxonomyTerm[]; author?: BlogPublicAuthor | null }): BlogPost {
  const full = 'content' in post, content = full ? post.content : post;
  const mediaHref = (id: string) => blogPublicMediaHref(options.site, content.slug, id);
  const terms = options.terms ?? [], categories = terms.filter(term => term.kind === 'category' && content.categoryIds.includes(term.id)), tags = terms.filter(term => term.kind === 'tag' && content.tagIds.includes(term.id));
  const blocks = full ? presentBlogDocument(post.content.document, mediaHref) : undefined;
  return { id: post.id, title: content.title, slug: content.slug, href: `${options.basePath}/${encodeURIComponent(content.slug)}`, excerpt: content.excerpt,
    featuredImage: content.featuredImage ? mediaHref(content.featuredImage.mediaId) : undefined, featuredImageAlt: content.featuredImage?.alt,
    author: presentBlogAuthor(post.author, options.author), publishedAt: new Date(post.publishedAt).toISOString(), updatedAt: new Date(post.updatedAt).toISOString(), blocks,
    categories: categories.map(term => ({ id: term.id, name: term.name, slug: term.slug, description: term.description, href: `${options.basePath}?category=${encodeURIComponent(term.id)}` })),
    tags: tags.map(term => ({ id: term.id, name: term.name, slug: term.slug, href: `${options.basePath}?tag=${encodeURIComponent(term.id)}` })),
    toc: blocks?.filter(block => block.type === 'heading').map(block => ({ id: block.anchor!, level: block.level, text: block.text })),
  };
}
