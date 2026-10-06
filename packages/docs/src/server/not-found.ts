/** A useful public reader 404 never reveals whether an unpublished source exists. */
import type { DocsPage } from '../content/types';

export function docsNotFoundPage(basePath: string): DocsPage {
  return { sourcePath: null, route: (basePath === '/' ? '' : basePath) + '/_404', title: 'Page not found', description: '',
    navigation: { label: 'Page not found', hidden: true }, searchable: false, headings: [],
    body: { type: 'root', children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'This documentation page is not available. It may have moved, or the link may be out of date.' }] },
      { type: 'paragraph', children: [{ type: 'link', url: basePath, children: [{ type: 'text', value: 'Return to documentation' }] }] },
    ] }, markdown: '', text: '', hash: '', assets: [], generated: true, metadata: {} };
}
