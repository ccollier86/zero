/** Bounded passage-aware local search over one admitted snapshot; no second scanner or external service. */
import type { DocsManifest } from '../content/types';
import type { DocsSearchResult } from '../ui/types';
import { freezeDocsValue } from '../content/identity';
import { docsMatchRanges, docsSearchTerms, docsTermQuality } from '../search/text';
import { admittedDocsSearchIndex, type DocsIndexedPage, type DocsIndexedPassage } from './search-index';
import { docsSearchExcerpt } from './search-excerpt';

interface Candidate { readonly score: number; readonly page: DocsIndexedPage; readonly passage?: DocsIndexedPassage; readonly excerptText: string }
const caches = new WeakMap<DocsManifest, Map<string, readonly DocsSearchResult[]>>();

/** Return at most 20 safe literal-search hits, with at most three distinct section targets per page. */
export function searchDocs(manifest: DocsManifest, query: string, limit = 20): readonly DocsSearchResult[] {
  const terms = docsSearchTerms(query), cap = Number.isFinite(limit) ? Math.max(0, Math.min(20, Math.floor(limit))) : 20;
  if (!terms.length || !cap) return [];
  let cache = caches.get(manifest); if (!cache) { cache = new Map(); caches.set(manifest, cache); }
  const key = JSON.stringify([terms, cap]), cached = cache.get(key); if (cached) return cached;
  const best: Candidate[] = [];
  for (const page of admittedDocsSearchIndex(manifest)) {
    const titleHits = terms.map(term => docsTermQuality(page.title.value, term)), descriptionHits = terms.map(term => docsTermQuality(page.description.value, term));
    const coverage = terms.map((_term, index) => titleHits[index]! > 0 || descriptionHits[index]! > 0);
    const pageBest: Candidate[] = [], sectionScores = new Map<string, readonly number[]>(), saturatedSections = new Set<string>(); let witness: DocsIndexedPassage | undefined;
    for (const passage of page.passages) {
      const identity = passage.passage.headingId ?? passage.passage.id;
      // Full-word hits for every term reach this section's maximum score; later windows cannot improve it.
      if (saturatedSections.has(identity)) continue;
      const bodyHits = terms.map(term => docsTermQuality(passage.text.value, term));
      let sectionHits = sectionScores.get(passage.sectionContext);
      if (!sectionHits) { sectionHits = terms.map(term => docsTermQuality(passage.sectionContext, term)); sectionScores.set(passage.sectionContext, sectionHits); }
      for (let index = 0; index < terms.length; index++) if (bodyHits[index] || sectionHits[index]) coverage[index] = true;
      if (!witness && bodyHits.some(Boolean)) witness = passage;
      if (!terms.every((_term, index) => titleHits[index] || bodyHits[index] || sectionHits[index] || descriptionHits[index])) continue;
      // Global metadata does not turn every unrelated paragraph into an additional search hit.
      if (!bodyHits.some(Boolean) && !terms.some(term => passage.section.value.includes(term))) continue;
      const score = terms.reduce((total, _term, index) => total + titleHits[index]! * 20 + sectionHits[index]! * 8 + bodyHits[index]! * 3 + descriptionHits[index]! * 2, 0)
        + (page.title.value === terms.join(' ') ? 200 : 0) + (passage.section.value === terms.join(' ') ? 40 : 0);
      insertBest(pageBest, { score, page, passage, excerptText: passage.text.original }, 3, true);
      if (bodyHits.every(hit => hit === 3)) saturatedSections.add(identity);
    }
    if (!coverage.every(Boolean)) continue;
    if (!pageBest.length) {
      const score = titleHits.reduce((total, hit) => total + hit * 20, 0) + descriptionHits.reduce((total, hit) => total + hit * 2, 0)
        + (page.title.value === terms.join(' ') ? 200 : 0);
      pageBest.push({ score, page, ...(witness ? { passage: witness } : {}), excerptText: witness?.text.original ?? page.page.description });
    }
    for (const candidate of pageBest) insertBest(best, candidate, cap);
  }
  const result = freezeDocsValue(best.map(candidate => project(candidate, terms)));
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, result); return result;
}
function project(candidate: Candidate, terms: readonly string[]): DocsSearchResult {
  const { page } = candidate.page, passage = candidate.passage?.passage;
  const sectionPath = passage?.sectionPath, section = sectionPath?.at(-1), { excerpt, matches } = docsSearchExcerpt(candidate.excerptText, terms);
  return { route: page.route + (passage?.headingId ? '#' + encodeURIComponent(passage.headingId) : ''), pageRoute: page.route, path: page.route, pageHash: page.hash,
    title: page.title, ...(section ? { section } : {}), excerpt,
    ...(passage ? { passageId: passage.id, sectionPath } : {}),
    matches: { title: docsMatchRanges(page.title, terms), ...(section ? { section: docsMatchRanges(section, terms) } : {}), excerpt: matches } };
}
function compare(left: Candidate, right: Candidate): number {
  return right.score - left.score || left.page.page.route.localeCompare(right.page.page.route, 'en')
    || (left.passage?.passage.id ?? '').localeCompare(right.passage?.passage.id ?? '', 'en', { numeric: true });
}
function insertBest(list: Candidate[], candidate: Candidate, cap: number, distinctSections = false): void {
  if (distinctSections) {
    const identity = candidate.passage?.passage.headingId ?? candidate.passage?.passage.id ?? '';
    const existing = list.findIndex(item => (item.passage?.passage.headingId ?? item.passage?.passage.id ?? '') === identity);
    if (existing >= 0) { if (compare(candidate, list[existing]!) >= 0) return; list.splice(existing, 1); }
  }
  const index = list.findIndex(item => compare(candidate, item) < 0);
  if (index >= 0) list.splice(index, 0, candidate); else if (list.length < cap) list.push(candidate);
  if (list.length > cap) list.length = cap;
}
