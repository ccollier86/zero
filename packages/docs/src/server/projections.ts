/** Public agent and sitemap projections use precisely the same admitted pages as SSR/search. */
import type { DocsManifest } from '../content/types';

/** Lightweight public route index; page bodies and arbitrary metadata stay in focused page projections. */
export function docsPublicIndex(manifest: DocsManifest) {
  return { version: manifest.version, basePath: manifest.basePath, hash: manifest.hash,
    pages: manifest.pages.map(page => ({ route: page.route, title: page.title, description: page.description, headings: page.headings,
      ...(page.semanticId ? { semanticId: page.semanticId } : {}) })), navigation: manifest.navigation, redirects: manifest.redirects };
}

export function docsAgentIndex(manifest: DocsManifest, title: string): string {
  return `# ${title.replace(/[\r\n]/gu, ' ')}\n\nRead-only documentation index.\n\n` + manifest.pages.map(page => `- [${page.title.replace(/[\[\]\\]/gu, '\\$&')}](${page.route}): ${page.description.replace(/[\r\n]/gu, ' ')}`).join('\n') + '\n';
}
export function docsSitemap(manifest: DocsManifest, siteUrl: string): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + manifest.pages.map(page => `<url><loc>${xml(siteUrl + page.route)}</loc></url>`).join('\n') + '\n</urlset>\n';
}
function xml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }
