/** Recognize only Bun's root installation marker. This metadata is never package content or evidence of archive integrity. */
import { lstat } from 'node:fs/promises';

export const BUN_INSTALL_TAG_NAME = '.bun-tag';

/** Refuse links/directories/special or unbounded entries without opening or trusting their contents. */
export async function assertBunInstallTag(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4_096) {
    throw new Error('[zero update] Invalid package-manager installation tag');
  }
}
