/**
 * Keeps Bun's text lockfile bound to the managed local framework archive.
 */

import { createHash } from 'node:crypto';

const FRAMEWORK_LOCK_PREFIX =
  '"@zero/framework": ["@zero/framework@./.zero/framework/zero-framework.tgz"';
const INTEGRITY_PATTERN = /"sha512-[A-Za-z0-9+/]+={0,2}"/g;

export function bindBunLockToLocalArchive(
  lockText: string,
  archiveBytes: Uint8Array
): string {
  const matchingLines = lockText
    .split(/\r?\n/)
    .filter((line) => line.includes(FRAMEWORK_LOCK_PREFIX));
  if (matchingLines.length !== 1) {
    throw new Error(
      `[zero update] Expected one managed @zero/framework entry in bun.lock; found ${matchingLines.length}`
    );
  }

  const entry = matchingLines[0];
  const integrityValues = entry.match(INTEGRITY_PATTERN) ?? [];
  if (integrityValues.length !== 1) {
    throw new Error(
      `[zero update] Expected one integrity value on the managed @zero/framework bun.lock entry; found ${integrityValues.length}`
    );
  }

  const digest = createHash('sha512').update(archiveBytes).digest('base64');
  const replacement = `"sha512-${digest}"`;
  if (integrityValues[0] === replacement) return lockText;
  return lockText.replace(entry, entry.replace(integrityValues[0], replacement));
}
