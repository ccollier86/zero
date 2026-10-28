/** Pure presentation paging. Manual/server counts remain authoritative; featured cards consume their page slots. */
import type { BlogPost, BlogFilterState, BlogPaginationState } from './blog.types';
import { uniqueBlogPosts } from './blog-post-list';
export function blogListModel(input: { posts: readonly BlogPost[]; recentPosts?: readonly BlogPost[]; filters: BlogFilterState;
  mode: 'local' | 'manual'; pageSize: number; localPage: number; pagination?: BlogPaginationState; showHero: boolean }) {
  const { filters } = input, query = filters.search?.trim() ?? '';
  const active = Boolean(query || filters.category || filters.author || filters.tag);
  const size = Math.max(1, Math.min(100, Number.isFinite(input.pageSize) ? Math.floor(input.pageSize) : 9));
  const rows = uniqueBlogPosts(input.posts).filter(post => input.mode === 'manual' ||
    (!filters.category || post.categories?.some(value => value.id === filters.category)) && (!filters.author || post.author?.id === filters.author)
    && (!filters.tag || post.tags?.some(value => value.id === filters.tag))
    && (!query || [post.title, post.excerpt, post.author?.name, ...(post.tags ?? []).map(value => value.name)].join(' ').normalize('NFKC').toLocaleLowerCase().includes(query.normalize('NFKC').toLocaleLowerCase())));
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const localPage = Math.max(1, Math.min(totalPages, Number.isFinite(input.localPage) ? Math.floor(input.localPage) : 1));
  const current = input.pagination ?? { currentPage: localPage, totalPages, ...(input.mode === 'local' ? { totalItems: rows.length } : {}), itemsPerPage: size };
  const visible = input.pagination || input.mode === 'manual' ? rows : rows.slice((localPage - 1) * size, localPage * size);
  const hero = input.showHero && !active && current.currentPage === 1 ? uniqueBlogPosts(input.recentPosts ?? visible).slice(0, 3) : [];
  const featuredIds = new Set(hero.map(post => post.id));
  return { active, query, current, hero, grid: visible.filter(post => !featuredIds.has(post.id)) };
}
