#!/usr/bin/env bash
set -euo pipefail

# Save a package from committed main and install launchers that consume it.
# The installer and launcher are copied; no command runs from this live checkout.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
exec bun "$ROOT_DIR/src/local-tools/install.ts"
