/** Deterministic Bun test-file inventory; no imports, execution, retries, or feature-specific exclusions. */

// Bun1.3.14 Scanner.zig admits lowercase basenames and skips only dependency/hidden directories.
// Walk filenames rather than a case-sensitive suffix glob so mixed-case names retain that behavior.
export const TEST_FILE_PATTERN = '**/*';
const TEST_FILE_NAME = /[._](?:test|spec)\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;

/** Enumerate normal Bun suffixes once; do not apply Gitignore, bunfig feature exclusions or build-folder assumptions. */
export async function discoverTestSuiteFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob(TEST_FILE_PATTERN).scan({ cwd: root, dot: true, onlyFiles: true, followSymlinks: false })) {
    const parts = file.split('/');
    const directories = parts.slice(0, -1);
    if (TEST_FILE_NAME.test(parts.at(-1)!.toLowerCase())
      && !directories.some(part => part.startsWith('.') || part.toLowerCase() === 'node_modules')) files.push(file);
  }
  return files.sort();
}
