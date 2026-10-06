/** Shared Shiki rendering for browser code, Bun SSR and compiled Markdown fences. */
import { guessEmbeddedLanguages, type HighlighterCore } from 'shiki/core';
import type { CodeBlockHighlightOptions, CodeBlockHighlightResult, CodeBlockTheme } from './code-block.types';
export type { CodeBlockHighlightOptions, CodeBlockHighlightResult, CodeBlockTheme } from './code-block.types';
import { codeBlockHighlightKey, readCodeBlockMetadata } from './code-block-metadata';
import { createCodeBlockTransformers } from './code-block-transformers';
import { zeroCodeBlockTheme } from './code-block-theme';
import { bindCodeBlockHighlightResult, snapshotCodeBlockHighlightOptions } from './code-block-highlight-identity';

let highlighter: Promise<HighlighterCore> | undefined;

/** Generate escaped/tokenized HTML; source is never interpreted as executable HTML. */
export async function highlightCodeBlock(
  code: string, language = 'text', options: CodeBlockHighlightOptions = {},
): Promise<CodeBlockHighlightResult> {
  options = snapshotCodeBlockHighlightOptions(options);
  const lang = language.trim().toLowerCase() || 'text';
  const key = codeBlockHighlightKey(code, lang, options);
  const core = await getHighlighter();
  const embedded = guessEmbeddedLanguages(code, lang);
  const requested = !['text', 'txt', 'plaintext', 'ansi'].includes(lang) ? [lang, ...embedded] : embedded;
  if (requested.some(name => !core.getLoadedLanguages().includes(name))) {
    const { bundledLanguages } = await import('shiki/langs');
    await Promise.all([...new Set(requested)].map(async name => {
      if (core.getLoadedLanguages().includes(name)) return;
      const loader = bundledLanguages[name as keyof typeof bundledLanguages];
      if (!loader) { if (name === lang) throw new Error(`Unsupported code language: ${lang}`); return; }
      await core.loadLanguage(await loader());
    }));
  }
  if (options.theme) {
    const { bundledThemes } = await import('shiki/themes');
    for (const name of [options.theme.light, options.theme.dark]) {
      if (core.getLoadedThemes().includes(name)) continue;
      const loader = bundledThemes[name as keyof typeof bundledThemes];
      if (!loader) throw new Error(`Unsupported code theme: ${name}`);
      await core.loadTheme(await loader());
    }
  }
  const html = normalizeCodeBlockLineHtml(core.codeToHtml(code, {
    lang, ...(options.theme ? { themes: { light: options.theme.light, dark: options.theme.dark } } : { theme: zeroCodeBlockTheme.name! }),
    meta: { __raw: options.meta ?? '' }, transformers: createCodeBlockTransformers(options, code.split('\n').length),
  }));
  return bindCodeBlockHighlightResult({ code, language: lang, html, key }, options);
}

/** Backward-compatible string helper; the optional fourth argument adds transforms. */
export async function highlightCodeBlockHtml(
  code: string, language: string, theme?: CodeBlockTheme, options: CodeBlockHighlightOptions = {},
): Promise<string> {
  return (await highlightCodeBlock(code, language, { ...options, ...(theme ? { theme } : {}) })).html;
}

/** Escaped SSR/loading/failure markup with the same row and anchor structure. */
export function buildFallbackCodeBlockHtml(code: string, options: CodeBlockHighlightOptions = {}): string {
  const lines = code.length > 0 ? code.split('\n') : [''];
  const metadata = readCodeBlockMetadata(options, lines.length);
  const html = lines.map((text, index) => {
    const line = metadata.startLine + index, prefix = metadata.prefix?.trim().replace(/\s+/g, '-');
    const id = prefix ? `${prefix}-l${line}` : undefined;
    const anchor = id ? `<a class="zero-code-line-anchor" href="#${escapeHtml(encodeURIComponent(id))}" aria-label="Link to line ${line}" tabindex="0"></a>` : '';
    return `<span class="line" data-line-number="${line}"${id ? ` id="${escapeHtml(id)}"` : ''}>${anchor}${escapeHtml(text) || '&nbsp;'}</span>`;
  }).join('');
  return `<pre class="shiki zero-code-block-fallback" tabindex="0"${metadata.wordWrap ? ' data-word-wrap="true"' : ''}><code>${html}</code></pre>`;
}

/** Remove Shiki's newline text nodes because block line spans already create rows. */
export function normalizeCodeBlockLineHtml(html: string): string {
  return html.replace(/<\/span>\r?\n(?=<span\b[^>]*\bclass="line(?:\s|"))/g, '</span>');
}

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= Promise.all([import('shiki/core'), import('shiki/engine/oniguruma')])
    .then(([{ createHighlighterCore }, { createOnigurumaEngine }]) => createHighlighterCore({
      themes: [zeroCodeBlockTheme], langs: [], engine: createOnigurumaEngine(import('shiki/wasm')),
    })).catch(error => { highlighter = undefined; throw error; });
  return highlighter;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
