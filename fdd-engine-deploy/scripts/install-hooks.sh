#!/usr/bin/env bash
#
# scripts/install-hooks.sh — install the pre-push gate into this clone.
#
# Run once, from anywhere in the repo:
#
#   ./fdd-engine-deploy/scripts/install-hooks.sh
#
# Hooks live in .git/hooks, which is not version-controlled — so this cannot be
# a committed file that just works. It has to be installed per clone. That is a
# real weakness of hooks as a mechanism and the reason .github/workflows/ci.yml
# stays: CI cannot be skipped, uninstalled, or forgotten on a fresh clone.
# The hook is the fast gate; CI is the one that can't be dodged. Keep both.
#
# The installed hook is a two-line shim that delegates to scripts/prepush.sh, so
# the real logic stays under version control and updates itself on pull. If a
# hook is already present and is not ours, this refuses rather than clobbering.

set -euo pipefail

APP="fdd-engine-deploy"
MARK="# managed by ${APP}/scripts/install-hooks.sh"

ROOT=$(git rev-parse --show-toplevel)
HOOKS=$(git rev-parse --git-path hooks)
case "$HOOKS" in /*) ;; *) HOOKS="$ROOT/$HOOKS" ;; esac
TARGET="$HOOKS/pre-push"

mkdir -p "$HOOKS"

if [ -e "$TARGET" ] && ! grep -q "$MARK" "$TARGET" 2>/dev/null; then
  echo "refusing to overwrite an existing hook that is not ours:" >&2
  echo "  $TARGET" >&2
  echo "move it aside and re-run." >&2
  exit 1
fi

cat > "$TARGET" <<EOF
#!/bin/sh
$MARK
exec "\$(git rev-parse --show-toplevel)/$APP/scripts/prepush.sh" "\$@"
EOF
chmod +x "$TARGET"
chmod +x "$ROOT/$APP/scripts/prepush.sh"

echo "installed: $TARGET"
echo
echo "It runs on every 'git push' — including pushes from GitHub Desktop, which"
echo "shells out to git and honours hooks. A failure shows there as a dialog"
echo "with the hook's output in it."
echo
echo "Bypass when you need to:  git push --no-verify   (or PREPUSH_SKIP=1)"
echo "Also run the test suite:  PREPUSH_TESTS=1 git push"
echo
echo "Smoke-test it now without pushing anything:"
echo "  $APP/scripts/prepush.sh </dev/null"
