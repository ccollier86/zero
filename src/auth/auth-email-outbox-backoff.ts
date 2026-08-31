export function authEmailRetryAt(input: {
  now: number;
  attempt: number;
  jobId: string;
  baseMs: number;
  maxMs: number;
}): number {
  const exponential = Math.min(input.maxMs,
    input.baseMs * (2 ** Math.max(0, input.attempt - 1)));
  const seed = [...input.jobId].reduce((total, char) => total + char.charCodeAt(0), 0);
  const jitter = 0.8 + (seed % 401) / 1_000;
  return input.now + Math.max(1, Math.floor(exponential * jitter));
}
