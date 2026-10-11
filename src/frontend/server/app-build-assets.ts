/** Optional browser assets built while composing a Zero application. */

import {
  OBS_CODES,
  type emitPlatformCode,
} from '../../observability';
import { buildClientBundle } from './client-bundle';
import { buildPlatformStyles } from './style-bundle';
import type { ResolvedConfig } from './types';
import { resolveAppThemeFoundation, type AppThemeFoundation } from './style-foundation';

export interface AppBuildAssets {
  readonly clientEntry?: string;
  readonly cssPath?: string;
  readonly themeFoundation?: AppThemeFoundation;
}

/**
 * Build the optional hydration and stylesheet assets without preventing the
 * SSR application from starting when optional legacy assets are unavailable.
 * Selected next foundation or plugin-required stylesheet failures abort instead
 * of quietly deploying an incomplete presentation contract.
 */
export async function buildAppAssets(
  config: Pick<ResolvedConfig, 'outDir' | 'appDir' | 'generatedDir'> & Partial<Pick<ResolvedConfig, 'themeFoundation'>>,
  emitCode: typeof emitPlatformCode,
  options: { readonly styleSources?: readonly string[]; readonly requiredStyles?: boolean } = {},
): Promise<AppBuildAssets> {
  const themeFoundation = resolveAppThemeFoundation(config.themeFoundation);
  let clientEntry: string | undefined;
  let cssPath: string | undefined;

  try {
    const bundle = await buildClientBundle(config.outDir, config.appDir, {
      generatedDir: config.generatedDir,
    });
    clientEntry = bundle.publicPath;
    emitCode(OBS_CODES.APP_CLIENT_BUNDLE_READY, {
      metadata: { publicPath: bundle.publicPath },
    });
  } catch {
    emitCode(OBS_CODES.APP_CLIENT_BUNDLE_FAILED, {
      metadata: { stage: 'client-bundle' },
    });
  }

  try {
    const styles = await buildPlatformStyles(config.outDir, config.appDir, options.styleSources, { themeFoundation });
    cssPath = styles.publicPath;
    emitCode(OBS_CODES.APP_STYLES_READY, {
      metadata: { publicPath: styles.publicPath },
    });
  } catch (error) {
    emitCode(OBS_CODES.APP_STYLES_FAILED, {
      metadata: { stage: 'style-bundle' },
    });
    if (options.requiredStyles || themeFoundation === 'next') throw error;
  }

  return {
    themeFoundation,
    ...(clientEntry ? { clientEntry } : {}),
    ...(cssPath ? { cssPath } : {}),
  };
}
