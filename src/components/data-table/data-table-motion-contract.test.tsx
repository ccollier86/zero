/** Exact motion configuration, escaped search text and facade parity. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DATA_TABLE_MOTION as M, dataTableMoveDuration } from './data-table-motion-tokens';
import { highlightDataTableText } from './data-table-search-highlight';

test('CSS duration tokens match the immutable public motion values', async () => {
  const css = await Bun.file(new URL('../../frontend/styles/data-table-motion-tokens.css', import.meta.url)).text();
  const names = { ui: 'ui', fast: 'fast', base: 'base', move: 'move', moveExtra: 'move-extra', pageOut: 'page-out',
    odo: 'odo', height: 'height', enterDelay: 'enter-delay', stagger: 'stagger', highlight: 'highlight',
    skeletonPulse: 'skeleton-pulse', skeletonOffset: 'skeleton-offset', searchDebounce: 'search-debounce' } as const;
  for (const [key, name] of Object.entries(names)) expect(css).toContain(`--zero-table-motion-${name}: ${M[key as keyof typeof names]}ms;`);
  expect(css).toContain(`--zero-table-motion-ease: ${M.ease};`);
  expect(Object.isFrozen(M)).toBe(true);
  expect(dataTableMoveDuration(1_000)).toBe(930);
  expect(dataTableMoveDuration(-100)).toBe(735);
});

test('search highlighting escapes HTML and treats punctuation as literal text', () => {
  const markup = renderToStaticMarkup(highlightDataTableText('<script>a.b</script> A.B', 'a.b'));
  expect(markup).not.toContain('<script>');
  expect(markup).toContain('&lt;script&gt;');
  expect(markup.match(/<mark /g)).toHaveLength(2);
  expect(renderToStaticMarkup(highlightDataTableText('ordinary text', '[.*]'))).toBe('ordinary text');
  expect(renderToStaticMarkup(highlightDataTableText('ordinary text', '   '))).toBe('ordinary text');
  expect(renderToStaticMarkup(highlightDataTableText('İstanbul', 'stan'))).toContain('>stan</mark>bul');
});
