/** Presentation identity only. This never fetches or grants access to an article. */
import type { BlogPost } from './blog.types';
export function uniqueBlogPosts(posts: readonly BlogPost[], excludeId?: string): BlogPost[] {
  const seen = new Set<string>();
  return posts.filter(post => {
    if (post.id === excludeId || seen.has(post.id)) return false;
    seen.add(post.id); return true;
  });
}
