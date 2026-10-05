/** Pure extraction of actual named catalog rows and their reader destinations. */
import { extractMarkdownLinks } from './markdown';

export interface CatalogHome {
  symbol: string;
  destination: string | null;
  rooted: boolean;
}

export function catalogHomes(source: string): CatalogHome[] {
  return source.split('\n').flatMap(row => {
    const symbol = row.match(/^\|\s*`([^`]+)`\s*\|/u)?.[1];
    if (!symbol) return [];
    const literal = row.match(/`((?:backend|frontend|cli|agents)\/[^`]+\.md(?:#[^`]+)?)`/u)?.[1];
    const linked = extractMarkdownLinks(row).findLast(link =>
      /(?:^|\/)(?:backend|frontend|cli|agents)\/.+\.md(?:#.*)?$/u.test(link)
      && !link.includes('/_work/'));
    return [{ symbol, destination: literal ?? linked ?? null, rooted: Boolean(literal) }];
  });
}
