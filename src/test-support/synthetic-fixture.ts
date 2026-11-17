import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

const markerName = ".storage-synthetic-fixture.json";
const pins = new Set([".storage-keep", ".keep", ".pin", "PINNED"]);
const repositories = new Set([".git", ".hg", ".svn"]);

async function exists(path: string) {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function requireStorage(parent: string) {
  if (process.platform === "darwin" && (parent === "/Volumes/code-bank" || parent.startsWith("/Volumes/code-bank/"))) {
    if (await exists(join(homedir(), ".local/state/dev-storage/external-health-hold.json")))
      throw Error("External filesystem integrity hold; fixture creation and cleanup are blocked");
    const bank = "/Volumes/code-bank";
    if (await realpath(bank) !== bank || (await lstat(bank)).isSymbolicLink() ||
        (await stat(bank)).dev === (await stat(homedir())).dev)
      throw Error("External development storage is unavailable; no internal fallback is allowed");
  }
}

/** Allocate only synthetic test state; the returned handle owns this exact run. */
export async function allocateSyntheticFixture(parent: string, label: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(label)) throw Error("Invalid synthetic fixture label");
  parent = resolve(parent);
  await requireStorage(parent);
  await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== parent) throw Error("Synthetic fixture parent must be a physical directory");
  const parentIdentity = await stat(parent);
  const root = await mkdtemp(join(parent, label + "-"));
  const identity = await lstat(root);
  const owner = { schema: 1, kind: "synthetic-test-fixture", project: "zero-platform",
    allocator: "src/test-support/synthetic-fixture.ts", label, run_id: randomUUID(), created_at: new Date().toISOString() };
  const encoded = JSON.stringify(owner) + "\n";
  await writeFile(join(root, markerName), encoded, { flag: "wx", mode: 0o600 });
  let removed = false;
  return {
    root,
    /** Call only after the fixture's server and every database handle have closed. */
    async cleanup(options: { onlyGeneratedDeployments?: boolean } = {}) {
      if (removed) return;
      await requireStorage(parent);
      const currentParent = await lstat(parent);
      const current = await lstat(root);
      if (await realpath(parent) !== parent || currentParent.dev !== parentIdentity.dev ||
          currentParent.ino !== parentIdentity.ino || current.isSymbolicLink() ||
          current.dev !== identity.dev || current.ino !== identity.ino)
        throw Error("Synthetic fixture identity changed; preserving files");
      for (const pin of pins) if (await exists(join(parent, pin))) return;
      for (const pin of pins) if (await exists(join(root, pin))) return;
      const marker = await lstat(join(root, markerName));
      if (!marker.isFile() || marker.nlink !== 1 || marker.size !== Buffer.byteLength(encoded) ||
          await readFile(join(root, markerName), "utf8") !== encoded)
        throw Error("Synthetic fixture ownership changed; preserving files");
      if (process.env.ZERO_KEEP_FIXTURES === "1") {
        // Scheduled retention must honor an intentionally retained debug run.
        const pin = join(root, ".storage-keep");
        if (!await exists(pin)) await writeFile(pin, JSON.stringify({
          purpose: "Explicit ZERO_KEEP_FIXTURES debug retention", owner: owner.run_id,
          reviewAfter: new Date(Date.now() + 7 * 86400000).toISOString(),
        }) + "\n", { flag: "wx", mode: 0o600 });
        return;
      }
      async function safeTree(directory: string): Promise<boolean> {
        for (const name of await readdir(directory)) {
          if (pins.has(name)) return false;
          if (repositories.has(name)) throw Error("Repository inside fixture; preserving files");
          const path = join(directory, name), entry = await lstat(path);
          // The package-test allocator owns these dependency links. Never walk
          // their targets; recursive rm unlinks the link itself.
          if (entry.isSymbolicLink() && relative(root, path).split("/").includes("node_modules")) continue;
          if (entry.dev !== identity.dev || entry.isSymbolicLink() ||
              (!entry.isDirectory() && (!entry.isFile() || entry.nlink !== 1)))
            throw Error("Unexpected fixture link or mount; preserving files");
          if (entry.isDirectory() && !await safeTree(path)) return false;
        }
        return true;
      }
      if (options.onlyGeneratedDeployments && label !== "installed")
        throw Error("Partial cleanup is limited to the owned installed-package fixture");
      const targets: string[] = [];
      for (const path of options.onlyGeneratedDeployments ? [join(root, "normal"), join(root, "compiled")] : [root]) {
        if (!await exists(path)) continue;
        const entry = await lstat(path);
        if (!entry.isDirectory() || entry.isSymbolicLink() || entry.dev !== identity.dev)
          throw Error("Generated deployment replaced; preserving files");
        if (!await safeTree(path)) return;
        targets.push(path);
      }
      await requireStorage(parent);
      const final = await lstat(root);
      if (final.dev !== identity.dev || final.ino !== identity.ino || final.isSymbolicLink())
        throw Error("Synthetic fixture changed during cleanup; preserving files");
      for (const target of targets) await rm(target, { recursive: true });
      removed = !options.onlyGeneratedDeployments;
    },
  };
}
