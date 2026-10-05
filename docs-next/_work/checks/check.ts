/** Read-only structural gate for docs-next; not a shipped CLI command. */

import { extractMarkdownLinks, parseDocumentationPage, type DocumentationPage } from './markdown';

const root = new URL('../../', import.meta.url);
const pages = new Map<string, DocumentationPage>();
const problems: string[] = [];
const ids = new Map<string, string>();
const types = new Set(['index', 'tutorial', 'how-to', 'reference', 'architecture', 'operations', 'roadmap', 'inventory', 'template']);

for (const path of new Bun.Glob('**/*.md').scanSync({ cwd: decodeURIComponent(root.pathname), onlyFiles: true })) {
  try {
    const page = parseDocumentationPage(await Bun.file(new URL(path, root)).text());
    pages.set(path, page);
    for (const key of ['id', 'type', 'audience', 'owner', 'status', 'visibility']) {
      if (!page.metadata[key]) problems.push(`${path}: missing metadata ${key}`);
    }
    const id = String(page.metadata.id ?? '');
    if (ids.has(id)) problems.push(`${path}: duplicate ID with ${ids.get(id)}`);
    ids.set(id, path);
    if (!types.has(String(page.metadata.type))) problems.push(`${path}: unknown page type`);
    if (!['draft', 'in-review', 'verified'].includes(String(page.metadata.status))) problems.push(`${path}: invalid review status`);
    if (!['public', 'internal'].includes(String(page.metadata.visibility))) problems.push(`${path}: invalid visibility`);
    if (!Array.isArray(page.metadata.audience)) problems.push(`${path}: audience must be a list`);
    if (path.startsWith('_work/') && page.metadata.visibility !== 'internal') problems.push(`${path}: working evidence must be internal`);
  } catch (error) {
    problems.push(`${path}: ${error instanceof Error ? error.message : 'parse failed'}`);
  }
}

function localTarget(path: string, link: string): URL | null {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(link)) return null;
  return new URL(link, new URL(path, root));
}

function pagePath(url: URL): string | null {
  return url.pathname.startsWith(root.pathname)
    ? decodeURIComponent(url.pathname.slice(root.pathname.length)) : null;
}

for (const [path, page] of pages) {
  const fileUrl = new URL(path, root);
  for (const link of page.links) {
    const url = localTarget(path, link);
    if (!url) continue;
    if (!await Bun.file(url).exists()) {
      problems.push(`${path}: missing target ${link}`);
      continue;
    }
    const targetPath = pagePath(url);
    const targetPage = targetPath ? pages.get(targetPath) : undefined;
    if (url.hash && targetPage && !targetPage.anchors.has(decodeURIComponent(url.hash.slice(1)))) {
      problems.push(`${path}: missing anchor ${link}`);
    }
    if (page.metadata.visibility === 'public' && targetPath
      && (targetPath.startsWith('_work/') || targetPage?.metadata.visibility === 'internal')) {
      problems.push(`${path}: public page links internal target ${link}`);
    }
  }
  if (path === 'index.md') continue;
  const parentPath = path.endsWith('/index.md')
    ? path.slice(0, -'/index.md'.length).replace(/[^/]+$/u, 'index.md')
    : path.replace(/[^/]+$/u, 'index.md');
  const parent = pages.get(parentPath);
  if (!parent) {
    problems.push(`${path}: missing parent index ${parentPath}`);
    continue;
  }
  if (!parent.links.some((link) => localTarget(parentPath, link)?.pathname === fileUrl.pathname)) {
    problems.push(`${path}: absent from parent index ${parentPath}`);
  }
  if (!extractMarkdownLinks(page.body.slice(0, 2000)).some((link) => {
    return localTarget(path, link)?.pathname === new URL(parentPath, root).pathname;
  })) problems.push(`${path}: missing early parent backlink`);
}

const reachable = new Set<string>();
function visit(path: string): void {
  if (reachable.has(path)) return;
  const page = pages.get(path);
  if (!page) return;
  reachable.add(path);
  for (const link of page.links) {
    const url = localTarget(path, link);
    const target = url && pagePath(url);
    if (target) visit(target);
  }
}
visit('index.md');
for (const path of pages.keys()) {
  if (!reachable.has(path)) problems.push(`${path}: unreachable from root index`);
}

console.log(JSON.stringify({ pages: pages.size, uniqueIds: ids.size, reachable: reachable.size, problems }, null, 2));
process.exitCode = problems.length > 0 ? 1 : 0;
