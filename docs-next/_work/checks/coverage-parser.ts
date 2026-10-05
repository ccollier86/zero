/** Pure inventory-table extraction across the existing authoring variants. */
import { extractMarkdownLinks } from './markdown';

export function inventoryFeatureDestinations(source: string): Array<{ feature: string; destination?: string }> {
  const section = source.match(/## (?:Features And Documentation Coverage|Actual Files And Features)\n([\s\S]*?)(?=\n## |$)/u)?.[1] ?? '';
  return section.split('\n').flatMap(row => {
    const feature = row.match(/^\|\s*([^|]+?)\s*\|/u)?.[1];
    if (!feature || /^-+$/u.test(feature)
      || ['Feature', 'Feature/family', 'Command/feature'].includes(feature)) return [];
    const literal = row.match(/`(?:docs-next\/)?((?:backend|frontend|cli|agents)\/[^`]+\.md)`/u)?.[1];
    const linked = extractMarkdownLinks(row).find(link =>
      /(?:^|\/)(?:backend|frontend|cli|agents)\/.+\.md(?:#.*)?$/u.test(link)
      && !link.includes('/_work/'));
    return [{ feature, ...(literal ? { destination: `docs-next/${literal}` }
      : linked ? { destination: linked } : {}) }];
  });
}
