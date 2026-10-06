/** Admit bounded compiler-owned search targets; never index source files or execute content. */
import type { DocsNode, DocsPage } from '../content/types';
import { docsNodeText } from '../content/markdown-text';
import { buildDocsPassages } from '../content/search-passages';
import { DOCS_MAX_LABEL_LENGTH } from '../content/search-bounds';

const SEARCH_BLOCKS = new Set(['paragraph', 'heading', 'code', 'tableRow', 'callout']);
const MAX_PASSAGES = 25_000;
const MAX_PASSAGE_TEXT = 4_096_000;

/** Preserve old snapshots while rejecting malformed, stale or unbound additive metadata. */
export function validateDocsSearchMetadata(page: DocsPage, invalid: () => never): void {
  if (!boundedLabel(page.title) || !page.navigation || !boundedLabel(page.navigation.label)
    || typeof page.navigation.hidden !== 'boolean') invalid();
  const headings = new Map<string, { text: string; depth: number }>();
  for (const heading of page.headings) {
    if (!heading || !boundedLabel(heading.id) || !heading.id || !boundedLabel(heading.text)
      || !Number.isInteger(heading.depth) || heading.depth < 1 || heading.depth > 6 || headings.has(heading.id)) invalid();
    headings.set(heading.id, heading);
  }
  if (page.titleHeadingId !== undefined && (!boundedLabel(page.titleHeadingId) || !headings.has(page.titleHeadingId))) invalid();
  const targets = new Set<string>(), seenHeadings = new Set<string>();
  function visit(node: DocsNode, parent?: DocsNode): void {
    if (node.code?.title !== undefined && !boundedLabel(node.code.title)) invalid();
    if (['footnoteDefinition', 'footnoteReference'].includes(node.type) && (!boundedLabel(node.id) || !node.id)) invalid();
    if (node.type === 'heading') {
      const heading = typeof node.id === 'string' ? headings.get(node.id) : undefined;
      if (!heading || seenHeadings.has(node.id!) || node.depth !== heading.depth
        || docsNodeText(node).replace(/\s+/gu, ' ').trim() !== heading.text) invalid();
      seenHeadings.add(node.id!);
    }
    if (node.searchId !== undefined) {
      if (!(SEARCH_BLOCKS.has(node.type) || node.type === 'text' && parent?.type === 'root') || !validTarget(node.searchId) || targets.has(node.searchId)) invalid();
      targets.add(node.searchId);
    }
    for (const child of node.children ?? []) visit(child, node);
  }
  visit(page.body);
  if (seenHeadings.size !== headings.size) invalid();
  if (page.passages === undefined) return;
  if (!Array.isArray(page.passages) || page.passages.length > MAX_PASSAGES) invalid();
  const ids = new Set<string>();
  for (const passage of page.passages) {
    if (!passage || !validTarget(passage.id) || ids.has(passage.id) || !targets.has(passage.id)
      || typeof passage.text !== 'string' || passage.text.length > MAX_PASSAGE_TEXT
      || !Array.isArray(passage.sectionPath) || passage.sectionPath.length > 6 || !passage.sectionPath.every(boundedLabel)
      || passage.headingId !== undefined && (!boundedLabel(passage.headingId) || !headings.has(passage.headingId))) invalid();
    ids.add(passage.id);
  }
  if (ids.size !== targets.size) invalid();
  // Re-derive from the already admitted AST: stale text or targets must not be
  // published merely because their shape is valid. Older snapshots omit both.
  const expected = buildDocsPassages(page.body);
  if (expected.passages.length !== page.passages.length) invalid();
  for (let index = 0; index < expected.passages.length; index++) {
    const actual = page.passages[index]!, derived = expected.passages[index]!;
    if (actual.id !== derived.id || actual.text !== derived.text || actual.headingId !== derived.headingId
      || actual.sectionPath.length !== derived.sectionPath.length || actual.sectionPath.some((value: string, part: number) => value !== derived.sectionPath[part])) invalid();
  }
  function compareTargets(actual: DocsNode, derived: DocsNode): void {
    if (actual.searchId !== derived.searchId) invalid();
    for (let index = 0; index < (actual.children?.length ?? 0); index++) compareTargets(actual.children![index]!, derived.children![index]!);
  }
  compareTargets(page.body, expected.body);
}

function boundedLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= DOCS_MAX_LABEL_LENGTH;
}
function validTarget(value: unknown): value is string {
  return boundedLabel(value) && /^docs-p-\d+$/u.test(value);
}
