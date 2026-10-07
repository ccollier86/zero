/** Small request-admission fence for one mounted MFA capability/scope, including StrictMode remounts. */
export class MfaManagementRequestLifecycle {
  private active = false;
  private revision = 0;
  constructor(private readonly isCurrentScope: () => boolean) {}

  activate(): void { this.active = true; this.revision += 1; }
  retire(): void { this.active = false; this.revision += 1; }

  /** Admit before dispatch and again before publishing a result or error. */
  begin(): (() => boolean) | null {
    if (!this.active || !this.isCurrentScope()) return null;
    const revision = ++this.revision;
    return () => this.active && revision === this.revision && this.isCurrentScope();
  }
}
