/** Native plugin setup owns admission, development watcher lifetime and exact mount routing. */
import { OBS_CODES } from '@zero/framework/server';
import type { ZeroPluginSetupContext } from '@zero/framework/server';
import type { ResolvedDocsOptions } from '../options';
import { admitDocsBuildData, readDocsCompiledSnapshot } from './artifact';
import { compileDocsSnapshot, docsContentRoot } from './build';
import { createDocsSnapshotRuntime } from './watch';
import { createDocsRequestHandler } from './handler';

export async function setupDocs(context: ZeroPluginSetupContext, options: ResolvedDocsOptions): Promise<void> {
  const emit = (code: typeof OBS_CODES.DOCS_STARTED | typeof OBS_CODES.DOCS_STOPPED | typeof OBS_CODES.DOCS_REBUILD_FAILED) => {
    try { context.emitCode(code, { metadata: { stage: 'runtime' } }); } catch { /* Observability is not publication authority. */ }
  };
  const data = admitDocsBuildData(context.frontend.plugins[options.name]?.data, options);
  const initial = await readDocsCompiledSnapshot(data, context.files);
  const watching = data.mode === 'development' && options.watch;
  const runtime = await createDocsSnapshotRuntime({ initial,
    ...(watching ? { watchRoot: docsContentRoot(context.projectRoot, options),
      compile: () => compileDocsSnapshot(context.projectRoot, options, 'development', context.emitCode), failed: () => emit(OBS_CODES.DOCS_REBUILD_FAILED) } : {}) });
  const handler = createDocsRequestHandler(runtime, options, context);
  const unregisterSitemap = context.seo?.registerSitemap(options.name, () => {
    const current = runtime.current();
    if (!current) throw new Error('Documentation publication is pending.');
    return current.data.manifest.pages.map(page => ({ href: options.siteUrl ? options.siteUrl + page.route : page.route }));
  });
  const mount = options.basePath, nested = options.basePath === '/' ? '/*' : options.basePath + '/*';
  context.app.get(mount, ({ request }) => handler(request)).head(mount, ({ request }) => handler(request))
    .get(nested, ({ request }) => handler(request)).head(nested, ({ request }) => handler(request))
    .onStop(async () => { unregisterSitemap?.(); await runtime.dispose(); emit(OBS_CODES.DOCS_STOPPED); });
  emit(OBS_CODES.DOCS_STARTED);
}
