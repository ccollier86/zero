/** Optional browser assets built while composing a Zero application. */

import {
  OBS_CODES,
  type emitPlatformCode,
} from '../../observability';
import { buildClientBundle } from './client-bundle';
import { buildPlatformStyles } from './style-bundle';
import type { ResolvedConfig } from './types';

export interface AppBuildAssets {
  readonly clientEntry?: string;
  readonly cssPath?: string;
}

/**
 * Build the optional hydration and stylesheet assets without preventing the
 * SSR application from starting when either build is unavailable.
 */
export async function buildAppAssets(
  config: Pick<ResolvedConfig, 'outDir' | 'appDir' | 'generatedDir'>,
  emitCode: typeof emitPlatformCode,
): Promise<AppBuildAssets> {
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
    const styles = await buildPlatformStyles(config.outDir, config.appDir);
    cssPath = styles.publicPath;
    emitCode(OBS_CODES.APP_STYLES_READY, {
      metadata: { publicPath: styles.publicPath },
    });
  } catch {
    emitCode(OBS_CODES.APP_STYLES_FAILED, {
      metadata: { stage: 'style-bundle' },
    });
  }

  return {
    ...(clientEntry ? { clientEntry } : {}),
    ...(cssPath ? { cssPath } : {}),
  };
}
