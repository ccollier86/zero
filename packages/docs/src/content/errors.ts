import type { DocsContentErrorCode, DocsDiagnostic } from './types';

/** Trusted tooling receives relative, bounded diagnostics; public adapters only expose the stable code. */
export class DocsContentError extends Error {
  readonly code: DocsContentErrorCode;
  readonly diagnostics: readonly DocsDiagnostic[];
  constructor(code: DocsContentErrorCode, diagnostics: readonly DocsDiagnostic[]) {
    super('Documentation content could not be admitted. Review the compiler diagnostics.');
    this.name = 'DocsContentError'; this.code = code;
    this.diagnostics = Object.freeze(diagnostics.map(item => Object.freeze({ ...item })));
  }
}
export function docsFailure(code: DocsContentErrorCode, message: string, details: Omit<DocsDiagnostic, 'code' | 'message'> = {}): never {
  throw new DocsContentError(code, [{ code, message, ...details }]);
}

