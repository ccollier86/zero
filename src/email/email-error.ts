/**
 * email-error.ts
 *
 * Defines the domain error used by Zero's email service and providers. It is
 * framework-neutral and should not know about auth, Elysia, or UI behavior.
 */

/** Domain error for platform email failures. */
export class EmailError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 500
  ) {
    super(message);
    this.name = 'EmailError';
  }
}
