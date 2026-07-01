/**
 * code-block-highlight.ts
 *
 * Owns CodeBlock syntax highlighting and HTML fallback generation. This module
 * does not render React, manage clipboard state, or emit UI events.
 */

import type { CodeBlockTheme } from './code-block.types';

const DEFAULT_THEME: CodeBlockTheme = {
  light: 'github-light',
  dark: 'github-dark-default',
};

/** Highlight source code with Shiki and return sanitized highlighter HTML. */
export async function highlightCodeBlockHtml(
  code: string,
  language: string,
  theme: CodeBlockTheme = DEFAULT_THEME,
): Promise<string> {
  const { codeToHtml } = await import('shiki');

  return normalizeCodeBlockLineHtml(await codeToHtml(code, {
    lang: normalizeLanguage(language),
    themes: {
      light: theme.light,
      dark: theme.dark,
    },
  }));
}

/**
 * Build plain escaped code HTML with Shiki-compatible `.line` spans.
 *
 * Used during SSR, hydration, and highlight failures so the component never
 * renders raw source through unescaped HTML.
 */
export function buildFallbackCodeBlockHtml(code: string): string {
  const lines = code.length > 0 ? code.split('\n') : [''];
  const lineHtml = lines
    .map((line) => `<span class="line">${escapeHtml(line) || '&nbsp;'}</span>`)
    .join('');

  return `<pre class="shiki zero-code-block-fallback" tabindex="0"><code>${lineHtml}</code></pre>`;
}

/**
 * Remove preserved newline text nodes between Shiki line spans.
 *
 * Shiki emits a newline between adjacent `.line` spans. Zero renders each line
 * span as its own row for line numbers, so preserving that text node inside
 * `<pre>` creates a visual blank row between code lines.
 */
export function normalizeCodeBlockLineHtml(html: string): string {
  return html.replaceAll('</span>\n<span class="line">', '</span><span class="line">');
}

function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return normalized || 'text';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
