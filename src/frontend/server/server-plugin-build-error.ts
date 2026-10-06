/** Stable trusted developer errors for declared plugin compilation/admission. */
export type AppPluginBuildErrorCode = 'APP_PLUGIN_BUILD_CONFIG_INVALID' | 'APP_PLUGIN_BUILD_FAILED' | 'APP_PLUGIN_BUILD_MISSING';

/** Build failures abort admission; public HTTP routes must never reflect this diagnostic. */
export class AppPluginBuildError extends Error {
  constructor(readonly code: AppPluginBuildErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppPluginBuildError';
  }
}
