#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bash cli-tools/install-macos.sh [--no-path]

Install zero-new, zero-update, zero-doctor and zero-release from this checkout.
By default, add the commands and Bun to the current user's zsh PATH.
Use --no-path to manage your shell configuration yourself.

Optional installation paths:
  ZERO_LOCAL_BIN_DIR       (default: ~/.local/bin)
  ZERO_LOCAL_TOOLS_DIR     (default: ~/.local/lib/zero-stable)
  ZERO_RELEASE_DIR         (default: ~/Library/Application Support/Zero/releases)
  ZERO_TOOLS_SCRATCH_DIR   (default: ~/Library/Caches/Zero/scratch)

See cli-tools/README.md and cli-tools/CODEX_SETUP.md for prerequisites and setup.
USAGE
}

WRITE_PATH=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-path) WRITE_PATH=false ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

if [[ "$(uname -s)" != Darwin ]]; then
  printf 'This installer is for macOS. See scripts/install-local-tools.sh for other systems.\n' >&2
  exit 1
fi
if ! command -v git >/dev/null || ! git --version >/dev/null 2>&1; then
  printf 'Install Apple Command Line Tools with xcode-select --install, then rerun setup.\n' >&2
  exit 1
fi
if ! command -v bun >/dev/null; then
  printf 'Install Bun and add it to PATH first. See cli-tools/README.md.\n' >&2
  exit 1
fi

ZERO_SETUP_REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ZERO_SETUP_REPO_ROOT"
if [[ ! -f src/local-tools/install.ts ]] || ! git show-ref --verify --quiet refs/heads/main; then
  printf 'Run this from a full Zero Git clone with a local main branch, not a downloaded ZIP.\n' >&2
  exit 1
fi
bun --no-env-file -e '
  const pkg = await Bun.file("package.json").json();
  if (pkg.name !== "@zero/framework" || !Bun.semver.satisfies(Bun.version, pkg.engines.bun)) {
    console.error(`This checkout requires Bun ${pkg.engines.bun}; found ${Bun.version}.`);
    process.exit(1);
  }
'

# Set every path explicitly so this Mac does not inherit another machine's drive layout.
export ZERO_LOCAL_BIN_DIR="${ZERO_LOCAL_BIN_DIR:-$HOME/.local/bin}"
export ZERO_LOCAL_TOOLS_DIR="${ZERO_LOCAL_TOOLS_DIR:-$HOME/.local/lib/zero-stable}"
export ZERO_RELEASE_DIR="${ZERO_RELEASE_DIR:-$HOME/Library/Application Support/Zero/releases}"
export ZERO_TOOLS_SCRATCH_DIR="${ZERO_TOOLS_SCRATCH_DIR:-$HOME/Library/Caches/Zero/scratch}"
for ZERO_SETUP_PATH in "$ZERO_LOCAL_BIN_DIR" "$ZERO_LOCAL_TOOLS_DIR" "$ZERO_RELEASE_DIR" "$ZERO_TOOLS_SCRATCH_DIR"; do
  if [[ "$ZERO_SETUP_PATH" != /* ]]; then
    printf 'Use absolute installation paths; got: %s\n' "$ZERO_SETUP_PATH" >&2
    exit 1
  fi
done
ZERO_SETUP_BUN_BIN="$(cd "$(dirname "$(command -v bun)")" && pwd -P)"
export PATH="$ZERO_LOCAL_BIN_DIR:$ZERO_SETUP_BUN_BIN:$PATH"

printf 'Framework checkout: %s\n' "$ZERO_SETUP_REPO_ROOT"
# Reuse the canonical installer. It generates wrappers/config with this Mac's
# checkout, runtime, release and scratch locations; no copied personal wrappers.
bun --no-env-file "$ZERO_SETUP_REPO_ROOT/src/local-tools/install.ts"

if [[ "$WRITE_PATH" == true ]]; then
  export ZERO_SETUP_ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"
  printf -v ZERO_SETUP_BIN_QUOTED '%q' "$ZERO_LOCAL_BIN_DIR"
  printf -v ZERO_SETUP_BUN_QUOTED '%q' "$ZERO_SETUP_BUN_BIN"
  export ZERO_SETUP_PATH_LINE="export PATH=$ZERO_SETUP_BIN_QUOTED:$ZERO_SETUP_BUN_QUOTED:\"\$PATH\""
  bun --no-env-file -e '
    const { mkdir, readFile, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const path = Bun.env.ZERO_SETUP_ZSHRC;
    const start = "# >>> Zero CLI tools >>>";
    const end = "# <<< Zero CLI tools <<<";
    let text;
    try { text = await readFile(path, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; text = ""; }
    const first = text.indexOf(start);
    const last = text.indexOf(end);
    if ((first === -1) !== (last === -1) || (first !== -1 && last < first)
      || text.indexOf(start, first + start.length) !== -1
      || text.indexOf(end, last + end.length) !== -1) {
      throw new Error(`Malformed Zero PATH block in ${path}. Repair it or use --no-path.`);
    }
    const block = `${start}\n${Bun.env.ZERO_SETUP_PATH_LINE}\n${end}`;
    const next = first === -1
      ? `${text}${text.endsWith("\n") || !text ? "" : "\n"}\n${block}\n`
      : text.slice(0, first) + block + text.slice(last + end.length);
    if (next !== text) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, next);
    }
    console.log(`Updated zsh PATH in ${path}`);
  '
fi

for ZERO_SETUP_COMMAND in zero-new zero-update zero-doctor zero-release; do
  "$ZERO_LOCAL_BIN_DIR/$ZERO_SETUP_COMMAND" --help
done
"$ZERO_LOCAL_BIN_DIR/zero-release" --status
printf '\nSetup complete. Open a new Terminal window, then run zero-release --status.\n'
if [[ "$WRITE_PATH" == false ]]; then
  printf 'Add these directories to your shell PATH: %s and %s\n' "$ZERO_LOCAL_BIN_DIR" "$ZERO_SETUP_BUN_BIN"
fi
