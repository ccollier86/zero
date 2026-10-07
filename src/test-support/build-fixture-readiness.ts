/**
 * Private build-fixture marker admission and publication. This test support
 * owns only synthetic startup files, not application startup or native signing.
 */
import { rename } from 'node:fs/promises'; // Bun has no atomic file-rename API.

/** Admit only a complete canonical timestamp observed within this child's startup window. */
export function parseBuildFixtureEntryTime(raw: string, startedAt: number, observedAt: number): number | undefined {
  if (!/^[1-9]\d*$/.test(raw)) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(startedAt) || !Number.isSafeInteger(observedAt)
    || startedAt <= 0 || observedAt < startedAt || value < startedAt || value > observedAt) return undefined;
  return value;
}

/** Publish a complete marker by rename; a failed unpublished temporary file remains diagnostic evidence. */
export async function publishBuildFixtureMarker(path: string, value: string): Promise<void> {
  const pending = `${path}.pending-${crypto.randomUUID()}`;
  await Bun.write(pending, value);
  await rename(pending, path);
}
