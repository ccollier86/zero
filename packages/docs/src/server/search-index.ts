/** Manifest-owned prebuilt passage windows and normalized labels; only admitted immutable public content. */
import type { DocsManifest, DocsPage, DocsPassage } from '../content/types';
import { buildDocsPassages } from '../content/search-passages';
import { createDocsSearchText, type DocsSearchText } from '../search/text';

export interface DocsIndexedPassage {
  readonly passage: DocsPassage;
  readonly text: DocsSearchText;
  readonly section: DocsSearchText;
  readonly sectionContext: string;
}
export interface DocsIndexedPage {
  readonly page: DocsPage;
  readonly title: DocsSearchText;
  readonly description: DocsSearchText;
  readonly passages: readonly DocsIndexedPassage[];
}
const indices = new WeakMap<DocsManifest, readonly DocsIndexedPage[]>();

/** Snapshot identity owns the index lifetime; excluded/unsearchable pages never enter it. */
export function admittedDocsSearchIndex(manifest: DocsManifest): readonly DocsIndexedPage[] {
  let index = indices.get(manifest);
  if (!index) {
    index = manifest.pages.filter(page => page.searchable).map(page => ({ page,
      title: createDocsSearchText(page.title), description: createDocsSearchText(page.description),
      passages: (page.passages ?? buildDocsPassages(page.body).passages).flatMap(passage => {
        const section = createDocsSearchText(passage.sectionPath.at(-1) ?? ''), sectionContext = createDocsSearchText(passage.sectionPath.join(' ')).value;
        return passageWindows(passage.text).map(text => ({ passage, text: createDocsSearchText(text), section, sectionContext }));
      }),
    }));
    indices.set(manifest, index);
  }
  return index;
}
function passageWindows(text: string): string[] {
  const windows: string[] = []; let start = 0;
  do {
    let end = Math.min(text.length, start + 2_048);
    if (end < text.length && /[\uDC00-\uDFFF]/u.test(text[end]!)) end--;
    windows.push(text.slice(start, end));
    if (end === text.length) break;
    // Canonically equivalent source graphemes can occupy more UTF-16 units than the 200-character query.
    // The larger overlap also retains full decomposed Latin/Hangul terms across internal windows.
    start = end - 800;
    if (/[\uDC00-\uDFFF]/u.test(text[start]!)) start--;
  } while (start < text.length);
  return windows;
}
