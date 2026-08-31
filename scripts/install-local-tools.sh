#!/usr/bin/env bash
set -euo pipefail

# install-local-tools.sh
#
# Installs local development wrappers for this checkout into ~/.bin by default.
# The wrappers keep generated apps in package-mode and install a publish-style
# framework archive without copying checkout source or secrets into the app.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
BIN_DIR="${ZERO_LOCAL_BIN_DIR:-$HOME/.bin}"

mkdir -p "$BIN_DIR"

cat >"$BIN_DIR/zero-new" <<EOF
#!/usr/bin/env bash
set -euo pipefail

ZERO_FRAMEWORK_DIR="$ROOT_DIR"
CREATE_ZERO="\$ZERO_FRAMEWORK_DIR/src/create-zero/run.ts"

usage() {
  cat <<'USAGE'
Usage:
  zero-new [target-dir] [options]

Creates a Zero package-mode app from a publish-style archive of this checkout.

Targets:
  no target-dir       Initialize the current directory.
  target-dir          Create/initialize that directory from the current path.

Options:
  --skip-install      Generate files without running bun install.
  --no-install        Alias for --skip-install.
  --force             Overwrite a non-empty target directory.
  --name <name>       Override generated package name.
  --zero <specifier>  Override @zero/framework dependency.
  --template <dir>    Use a custom create-zero template directory.
  -h, --help          Show this help.

Examples:
  zero-new
  zero-new my-app
  zero-new my-app --skip-install
  zero-new . --force
USAGE
}

if [[ ! -f "\$CREATE_ZERO" ]]; then
  echo "zero-new: create-zero entry not found at \$CREATE_ZERO" >&2
  exit 1
fi

target=""
install=true
create_args=()

while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --skip-install|--no-install)
      install=false
      shift
      ;;
    --name|--zero|--template)
      if [[ \$# -lt 2 ]]; then
        echo "zero-new: missing value for \$1" >&2
        exit 1
      fi
      create_args+=("\$1" "\$2")
      shift 2
      ;;
    --*)
      create_args+=("\$1")
      shift
      ;;
    *)
      if [[ -z "\$target" ]]; then
        target="\$1"
      else
        create_args+=("\$1")
      fi
      shift
      ;;
  esac
done

if [[ -z "\$target" ]]; then
  target="."
fi

cmd=(bun "\$CREATE_ZERO" "\$target" --local)

if [[ "\$install" == true ]]; then
  cmd+=(--install)
fi

if [[ \${#create_args[@]} -gt 0 ]]; then
  cmd+=("\${create_args[@]}")
fi

exec "\${cmd[@]}"
EOF

cat >"$BIN_DIR/zero-doctor" <<EOF
#!/usr/bin/env bash
set -euo pipefail

ZERO_FRAMEWORK_DIR="$ROOT_DIR"
DOCTOR="\$ZERO_FRAMEWORK_DIR/src/doctor/run.ts"

if [[ ! -f "\$DOCTOR" ]]; then
  echo "zero-doctor: doctor entry not found at \$DOCTOR" >&2
  exit 1
fi

exec bun "\$DOCTOR" "\$@"
EOF

cat >"$BIN_DIR/zero-update" <<EOF
#!/usr/bin/env bash
set -euo pipefail

ZERO_FRAMEWORK_DIR="$ROOT_DIR"
UPDATE_ZERO="\$ZERO_FRAMEWORK_DIR/src/update/run.ts"

usage() {
  cat <<'USAGE'
Usage:
  zero-update [project-dir] [--dry-run] [--check]

Safely updates @zero/framework in an existing app from the Zero checkout that
installed this wrapper. The project defaults to the current directory. Stop the
app/dev server before updating.

Options:
  --dry-run       Show the planned update without changing the project.
  --check         Run the project's typecheck and Doctor scripts after installation.
  -h, --help      Show this help.

Examples:
  cd /path/to/my-app && zero-update
  zero-update /path/to/my-app
  zero-update /path/to/my-app --dry-run
  zero-update /path/to/my-app --check

This is an updater, not a scaffolder. Never use create-zero --force or
zero-new --force to update an existing project.

The project must already have one Bun lockfile, including for --dry-run. Local
archive updates require the text bun.lock so its archive integrity can be
refreshed safely. Commit that lockfile for checkout-local apps. After a clean clone,
the ignored .zero/framework archive and directories may be absent; a mutating
update recreates them, while --dry-run leaves them absent. Existing symlinks or
wrong-type entries at those managed paths are rejected. By default no project
scripts run. Before using --check, review those app-owned scripts: their side
effects are outside updater rollback. Zero never directly selects a migration
command.
USAGE
}

if [[ ! -f "\$UPDATE_ZERO" ]]; then
  echo "zero-update: update entry not found at \$UPDATE_ZERO" >&2
  exit 1
fi

if [[ \${1:-} == "-h" || \${1:-} == "--help" ]]; then
  usage
  exit 0
fi

project_args=()
if [[ \$# -gt 0 && \$1 != -* ]]; then
  project_args=(--project "\$1")
  shift
fi

has_project=false
for arg in "\$@"; do
  case "\$arg" in
    --project|--project=*)
      if [[ \${#project_args[@]} -gt 0 ]]; then
        echo "zero-update: project directory was provided more than once" >&2
        exit 1
      fi
      has_project=true
      ;;
    --local|--local=*|--latest)
      echo "zero-update: \$arg cannot override this checkout-bound wrapper" >&2
      echo "Run 'zero update \$arg ...' when you need a different update source." >&2
      exit 1
      ;;
  esac
done

if [[ \${#project_args[@]} -eq 0 && "\$has_project" == false ]]; then
  project_args=(--project "\$PWD")
fi

exec bun "\$UPDATE_ZERO" "\${project_args[@]}" --local "\$ZERO_FRAMEWORK_DIR" "\$@"
EOF

chmod +x "$BIN_DIR/zero-new" "$BIN_DIR/zero-doctor" "$BIN_DIR/zero-update"

cat <<EOF
Installed Zero local tools:
  $BIN_DIR/zero-new
  $BIN_DIR/zero-doctor
  $BIN_DIR/zero-update

Make sure $BIN_DIR is on PATH.
EOF
