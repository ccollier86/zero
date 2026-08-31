const AUTHORIZATION_BOUNDARY_REASONS = new Set([
  'Auth context changed',
  'Sync access changed',
]);

/** True when a server close invalidates the authorization scope of local data. */
export function requiresSyncCachePurge(
  event: Pick<CloseEvent, 'code' | 'reason'>,
): boolean {
  return event.code === 4001 && AUTHORIZATION_BOUNDARY_REASONS.has(event.reason);
}
