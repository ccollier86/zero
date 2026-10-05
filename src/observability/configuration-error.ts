/** Stable startup/admission errors for observability configuration, without raw values. */
export class ObservabilityConfigurationError extends Error {
  readonly code = 'OBSERVABILITY_CONFIG_INVALID';

  /** Reject an invalid observability setting before creating its owned runtime. */
  constructor(message: string) {
    super(message);
    this.name = 'ObservabilityConfigurationError';
  }
}
