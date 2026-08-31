#!/usr/bin/env bash
set -euo pipefail

# Legacy convenience wrapper for local Zero development.
#
# Prefer the framework CLI directly:
#
#   bun run create-zero -- ../my-app --local --install
#
# This wrapper keeps the old script name but now generates a package-mode app
# backed by a publish-style local framework archive instead of copying or
# directly linking framework source into the target project.

if [[ $# -lt 1 ]]; then
  echo "Usage: ./scripts/create-project.sh <target-dir> [--skip-install] [create-zero flags...]"
  exit 1
fi

PLATFORM_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="$1"
shift

INSTALL=true
ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install)
      INSTALL=false
      shift
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ "$INSTALL" == true ]]; then
  ARGS+=("--install")
fi

exec bun "$PLATFORM_DIR/src/create-zero/run.ts" "$TARGET_DIR" --local "${ARGS[@]}"
