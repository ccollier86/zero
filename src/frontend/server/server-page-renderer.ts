/** Render native plugin pages through Zero's existing consuming-app React SSR boundary. */
import type { ComponentType } from 'react';
import type { PageMeta } from '../router/types';
import { loadSsrReactRuntime, wrapWithHtmlShell } from '../router/renderer';
import { emitPlatformCode, OBS_CODES, type emitPlatformCode as EmitCode } from '../../observability';
import type { ResolvedAppFrontendAssets } from './server-plugin-build-types';

/** Read-only server page rendering; permission admission must happen before calling it. */
export interface RenderServerPageOptions<TProps extends object> {
  readonly component: ComponentType<TProps>;
  readonly props: TProps;
  readonly request: Request;
  readonly appDir: string;
  readonly frontend: ResolvedAppFrontendAssets;
  /** Include only this plugin's public enhancement/style assets, never compiled content data. */
  readonly pluginName?: string;
  /** HTML-only hydration container; it is not part of the React component tree. */
  readonly rootId?: string;
  readonly meta?: PageMeta;
  readonly nonce?: string;
  readonly status?: number;
  readonly emitCode?: typeof EmitCode;
}

/** Stream useful SSR without requiring AppProvider hydration or inline document-data scripts. */
export async function renderServerPage<TProps extends object>(options: RenderServerPageOptions<TProps>): Promise<Response> {
  const emit = options.emitCode ?? emitPlatformCode;
  let failureReported = false;
  if (options.request.method === 'HEAD') return new Response(null, { status: options.status ?? 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  try {
    const { createElement, renderToReadableStream } = await loadSsrReactRuntime(options.appDir, options.frontend.pluginSsrRuntime ?? 'app');
    const element = createElement(options.component, options.props);
    const stream = await renderToReadableStream(element, {
      ...(options.nonce ? { nonce: options.nonce } : {}),
      onError() { if (!failureReported) { failureReported = true; emit(OBS_CODES.RENDERER_SSR_ERROR, { metadata: { stage: 'plugin-page' } }); } },
    });
    const head = buildHead(options);
    const response = new Response(wrapWithHtmlShell(stream, head, { rootId: options.rootId }), {
      status: options.status ?? 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
    return response;
  } catch {
    if (!failureReported) emit(OBS_CODES.RENDERER_FATAL_ERROR, { metadata: { stage: 'plugin-page' } });
    return new Response('Page could not be rendered.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

function buildHead<TProps extends object>(options: RenderServerPageOptions<TProps>): string {
  const parts = ['<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">'];
  if (options.meta?.title) parts.push(`<title>${escapeAttribute(options.meta.title)}</title>`);
  if (options.meta?.description) parts.push(`<meta name="description" content="${escapeAttribute(options.meta.description)}">`);
  const styles = new Set<string>(options.frontend.cssPath ? [options.frontend.cssPath] : []);
  const scripts = new Set<string>();
  const plugin = options.pluginName ? options.frontend.plugins[options.pluginName] : undefined;
  for (const asset of Object.values(plugin?.assets ?? {})) {
    if (asset.kind === 'style') styles.add(asset.publicPath);
    if (asset.kind === 'script') scripts.add(asset.publicPath);
  }
  const nonce = options.nonce ? ` nonce="${escapeAttribute(options.nonce)}"` : '';
  for (const path of styles) parts.push(`<link rel="stylesheet" href="${escapeAttribute(path)}"${nonce}>`);
  for (const path of scripts) parts.push(`<script type="module" src="${escapeAttribute(path)}"${nonce}></script>`);
  return parts.join('\n');
}
function escapeAttribute(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
