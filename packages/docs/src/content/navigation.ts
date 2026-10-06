/** Folder-driven navigation and generated landings from admitted pages only. */
import { basename, dirname } from 'node:path';
import type { DocsNavigationEntry, DocsNode, DocsPage } from './types';
import { compareDocsPaths, docsLabel } from './identity';
import { docsFolderRoute } from './routes';

export function buildDocsNavigation(authored: readonly DocsPage[], basePath: string): { pages: DocsPage[]; navigation: readonly DocsNavigationEntry[] } {
  const pages = [...authored], folders = new Set<string>(['']);
  for (const page of authored) {
    let folder = sourceFolder(page.sourcePath);
    while (folder) { folders.add(folder); folder = parentFolder(folder); }
  }
  const landing = new Map<string, DocsPage>(), generated = new Map<string, DocsPage>();
  for (const folder of [...folders].sort(compareDocsPaths)) {
    const candidates = authored.filter(page => page.sourcePath && sourceFolder(page.sourcePath) === folder);
    const index = candidates.find(page => basename(page.sourcePath!).toLowerCase() === 'index.md');
    const readme = candidates.find(page => basename(page.sourcePath!).toLowerCase() === 'readme.md');
    const existing = index ?? readme ?? pages.find(page => page.route === docsFolderRoute(folder, basePath));
    if (existing) { landing.set(folder, existing); continue; }
    const title = folder ? docsLabel(basename(folder)) : 'Documentation';
    const page: DocsPage = { sourcePath: null, route: docsFolderRoute(folder, basePath), title, description: `Browse ${title.toLowerCase()}.`,
      navigation: { label: title, hidden: false }, searchable: false, headings: [], body: { type: 'root', children: [] },
      markdown: '', text: '', hash: '', assets: [], generated: true, metadata: Object.freeze({}) };
    pages.push(page); landing.set(folder, page); generated.set(folder, page);
  }
  const landingRoutes = new Set([...landing.values()].map(page => page.route));
  const children = (folder: string): Array<{ entry: DocsNavigationEntry; order: number; key: string }> => {
    const items: Array<{ entry: DocsNavigationEntry; order: number; key: string }> = authored.filter(page => !page.navigation.hidden && sourceFolder(page.sourcePath) === folder && !landingRoutes.has(page.route))
      .map(page => ({ entry: { type: 'page' as const, label: page.navigation.label, route: page.route },
        order: page.navigation.order ?? Infinity, key: page.sourcePath! }));
    for (const childFolder of folders) {
      if (!childFolder || parentFolder(childFolder) !== folder) continue;
      const intro = landing.get(childFolder)!;
      const descendants = children(childFolder).map(item => item.entry);
      const hasExplicitIntro = !intro.generated && !intro.navigation.hidden;
      if (!hasExplicitIntro && !descendants.length) continue;
      items.push({ entry: { type: 'group', label: intro.navigation.hidden ? docsLabel(basename(childFolder)) : intro.navigation.label, route: intro.navigation.hidden ? descendants[0]!.route : intro.route,
        children: descendants }, order: intro.navigation.order ?? Infinity, key: childFolder });
    }
    return items.sort((left, right) => left.order - right.order || compareDocsPaths(left.key, right.key));
  };
  for (const [folder, page] of generated) {
    const entries = children(folder).map(item => item.entry);
    const heading: DocsNode = { type: 'heading', depth: 1, id: 'documentation', children: [{ type: 'text', value: page.title }] };
    const description = entries.length ? 'Choose a topic to get started.' : 'Add a Markdown document to this collection to get started.';
    const list: DocsNode = { type: 'list', ordered: false, children: entries.map(entry => ({ type: 'listItem', checked: null,
      children: [{ type: 'paragraph', children: [{ type: 'link', url: entry.route, children: [{ type: 'text', value: entry.label }] }] }] })) };
    Object.assign(page, { titleHeadingId: 'documentation', headings: [{ id: 'documentation', text: page.title, depth: 1 }],
      body: { type: 'root', children: [heading, { type: 'paragraph', children: [{ type: 'text', value: description }] }, ...(entries.length ? [list] : [])] },
      markdown: `# ${markdownText(page.title)}\n\n${description}\n` + entries.map(entry => `\n- [${markdownText(entry.label)}](${entry.route})`).join('') + '\n',
      text: [page.title, description, ...entries.map(entry => entry.label)].join('\n') });
  }
  const home = landing.get('')!;
  const navigation = [...(!home.navigation.hidden ? [{ type: 'page' as const, label: home.navigation.label, route: home.route }] : []), ...children('').map(item => item.entry)];
  return { pages, navigation };
}
function sourceFolder(sourcePath: string | null): string { const folder = sourcePath ? dirname(sourcePath).replace(/\\/gu, '/') : '.'; return folder === '.' ? '' : folder; }
function parentFolder(folder: string): string { const parent = dirname(folder).replace(/\\/gu, '/'); return parent === '.' ? '' : parent; }
function markdownText(text: string): string { return text.replace(/[\\`*_{}\[\]<>()#+.!|]/gu, '\\$&'); }
