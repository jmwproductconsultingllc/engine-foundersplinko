#!/usr/bin/env bash
#
# scripts/prepush.sh — THE COMMIT-COMPLETENESS GATE.
#
# WHY THIS EXISTS
#
# Commit e6ca868 ("glass header") failed the Vercel build with:
#
#   ./components/ReportGlass.tsx:501:13
#   Type error: Type '"glass"' is not assignable to type 'CaptureSurface | undefined'.
#
# There was no defect in the code. On disk, EmailCapture.tsx already had "glass"
# in the CaptureSurface union. The change to EmailCapture.tsx was simply never
# committed. The component shipped; the type it depended on stayed home.
#
# The general shape, and the reason no existing guard caught it:
#
#   THE WORKING TREE TYPECHECKS; THE COMMIT DOES NOT.
#
# `npx tsc --noEmit` and `vitest run` both read the working tree — every file as
# it sits on disk, committed or not. Nothing in this repo has ever type-checked
# the set of files actually being pushed. A changeset split across a commit
# boundary is invisible locally and only surfaces when Vercel clones the commit.
#
# .github/workflows/ci.yml does run tsc + vitest, but it runs ON push, in
# parallel with Vercel. It reports the same failure at the same time. It is a
# second witness, not a gate.
#
# This script is the gate. It runs before the push leaves the machine.
#
# WHAT IT CHECKS
#
#   GATE 1 — uncommitted source under the app directory. Instant. This is the
#            direct signature of a partial commit and it names the exact files.
#   GATE 2 — `tsc --noEmit` against the COMMITTED tree, exported from the ref
#            being pushed. This is ground truth: it type-checks precisely what
#            Vercel is about to clone.
#
# Gate 2 subsumes gate 1 in strictness, but gate 1 stays because it is instant
# and its diagnosis is legible. When gate 2 fails you get a type error; when
# gate 1 fails you get "you forgot to commit this file", which is the actual
# problem in every occurrence of this defect so far.
#
# WHAT IT DELIBERATELY DOES NOT CHECK
#
# It does not run vitest. 366 tests is 30-60s, and a push hook that costs a
# minute is a push hook that gets bypassed by the second week. The failure mode
# this exists for is compile-level; the tests stay in CI where their latency is
# free. If that trade ever looks wrong, PREPUSH_TESTS=1 turns them on.
#
# FAIL-OPEN ON INFRASTRUCTURE, FAIL-CLOSED ON FINDINGS
#
# Missing node_modules, an unreadable git dir, no tsc — these WARN and allow the
# push. A verifier that blocks pushes for reasons unrelated to the code is a
# verifier that gets uninstalled, and then it catches nothing forever. Only an
# actual finding blocks.
#
# ESCAPE HATCH
#
#   PREPUSH_SKIP=1 git push     # skip entirely
#   git push --no-verify        # same, git's own bypass
#
# INSTALL
#
#   fdd-engine-deploy/scripts/install-hooks.sh
#
# Written for macOS's stock bash 3.2 — no mapfile, no associative arrays.

set -uo pipefail

APP="fdd-engine-deploy"

# --- colours, only when attached to a terminal -------------------------------
if [ -t 2 ]; then
  R=$'\033[31m'; Y=$'\033[33m'; G=$'\033[32m'; B=$'\033[1m'; X=$'\033[0m'
else
  R=""; Y=""; G=""; B=""; X=""
fi

say()  { printf '%s\n' "$*" >&2; }
warn() { printf '%s\n' "${Y}prepush:${X} $*" >&2; }

if [ "${PREPUSH_SKIP:-}" = "1" ]; then
  warn "PREPUSH_SKIP=1 — gate skipped by request"
  exit 0
fi

# A hook inherits GIT_DIR/GIT_INDEX_FILE pointing at the pushing repo. Any git
# command we run in a temp directory would then quietly operate on the real
# repo instead. Clear them before doing anything else.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_OBJECT_DIRECTORY 2>/dev/null || true

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$ROOT" ] || [ ! -d "$ROOT/$APP" ]; then
  warn "cannot locate the repo root or $APP/ — allowing push (fail-open)"
  exit 0
fi
cd "$ROOT" || exit 0

# --- which commit is actually being pushed? ----------------------------------
#
# git hands a pre-push hook lines of "<localref> <localsha> <remoteref> <remotesha>"
# on stdin. The local sha is the tip being sent — that is the commit Vercel will
# build, and it is not necessarily HEAD. Deleted refs come through as all-zero
# and are skipped. Run by hand with no stdin, we fall back to HEAD.
ZERO="0000000000000000000000000000000000000000"
TARGET=""
if [ ! -t 0 ]; then
  while read -r _localref localsha _remoteref _remotesha; do
    [ -n "${localsha:-}" ] || continue
    [ "$localsha" = "$ZERO" ] && continue
    TARGET="$localsha"
  done
fi
[ -n "$TARGET" ] || TARGET=$(git rev-parse HEAD 2>/dev/null)
if [ -z "$TARGET" ]; then
  warn "cannot resolve the commit being pushed — allowing push (fail-open)"
  exit 0
fi

SHORT=$(git rev-parse --short "$TARGET" 2>/dev/null || echo "$TARGET")
say ""
say "${B}prepush — checking the commit, not the working tree${X}  (${SHORT})"

FAILED=0

# =============================================================================
# GATE 1 — uncommitted source under the app directory
# =============================================================================
#
# Two shapes, both seen in this repo:
#
#   MODIFIED, not committed — e6ca868: EmailCapture.tsx was edited and left out.
#   NEW, never committed    — the hero changeset: ReportGlass.tsx imports
#                             @/lib/publicFormat, a file that does not exist in
#                             the repo at all yet.
#
# Scope is deliberately narrow. data/*.json is excluded: an uncommitted brand
# record means a tile is missing, not that the build breaks, and Jason routinely
# has brand JSON in flight. A gate that is red on every push is a gate someone
# disables — and a disabled gate catches nothing, forever.

is_watched() {
  case "$1" in
    "$APP"/data/*) return 1 ;;                          # brand records: not our business
    *.ts|*.tsx|*.css|*.mjs) return 0 ;;
    "$APP"/package.json|"$APP"/tsconfig.json) return 0 ;;
    "$APP"/next.config.*|"$APP"/vitest.config.*) return 0 ;;
    *) return 1 ;;
  esac
}

DIRTY_NEW=""
DIRTY_MOD=""
STATUS=$(git status --porcelain --untracked-files=all -- "$APP" 2>/dev/null)
if [ -n "$STATUS" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    code=$(printf '%s' "$line" | cut -c1-2)
    path=$(printf '%s' "$line" | cut -c4-)
    # renames arrive as "old -> new"; the new path is what matters
    case "$path" in *" -> "*) path=${path##* -> } ;; esac
    # git quotes paths containing unusual characters
    path=$(printf '%s' "$path" | sed 's/^"//; s/"$//')
    is_watched "$path" || continue
    if [ "$code" = "??" ]; then
      DIRTY_NEW="${DIRTY_NEW}    ${path}"$'\n'
    else
      DIRTY_MOD="${DIRTY_MOD}    ${path}"$'\n'
    fi
  done <<EOF
$STATUS
EOF
fi

if [ -n "$DIRTY_NEW" ] || [ -n "$DIRTY_MOD" ]; then
  FAILED=1
  say ""
  say "${R}${B}GATE 1 FAILED — source under $APP/ is not in the commit${X}"
  if [ -n "$DIRTY_MOD" ]; then
    say ""
    say "  ${B}Edited, but not committed:${X}"
    printf '%s' "$DIRTY_MOD" >&2
  fi
  if [ -n "$DIRTY_NEW" ]; then
    say ""
    say "  ${B}New, never committed:${X}"
    printf '%s' "$DIRTY_NEW" >&2
  fi
  say ""
  say "  This is the shape of e6ca868. The working tree compiles because these"
  say "  files are on disk; the pushed commit will not, because they are not in it."
  say ""
  say "  Commit them, or stash them. The Changes list for $APP/ should be empty."
fi

# =============================================================================
# GATE 2 — type-check the committed tree
# =============================================================================
#
# Export the app subtree at the pushed commit into a temp dir, borrow the real
# node_modules, and run the repo's own tsc against it. This is what Vercel does,
# minus the bundling.

TSC="$ROOT/$APP/node_modules/.bin/tsc"
if [ ! -x "$TSC" ]; then
  warn "no $APP/node_modules/.bin/tsc — skipping the typecheck gate (run npm install)"
elif ! command -v tar >/dev/null 2>&1; then
  warn "tar not found — skipping the typecheck gate"
else
  TMP=$(mktemp -d 2>/dev/null || mktemp -d -t prepush)
  if [ -z "$TMP" ] || [ ! -d "$TMP" ]; then
    warn "cannot create a temp dir — skipping the typecheck gate"
  else
    trap 'rm -rf "$TMP"' EXIT INT TERM
    if ! git archive "$TARGET" "$APP" 2>/dev/null | tar -x -C "$TMP" 2>/dev/null; then
      warn "could not export $APP/ at $SHORT — skipping the typecheck gate"
    elif [ ! -f "$TMP/$APP/tsconfig.json" ]; then
      # Not fail-open noise: a commit with no tsconfig under the app dir IS a
      # broken commit. But it is also what a fresh/odd repo layout looks like,
      # so say plainly which one this is rather than guessing.
      say ""
      say "${R}${B}GATE 2 FAILED — $APP/tsconfig.json is not in commit $SHORT${X}"
      say "  Vercel will clone this commit and have nothing to build."
      FAILED=1
    else
      ln -s "$ROOT/$APP/node_modules" "$TMP/$APP/node_modules" 2>/dev/null
      say ""
      say "  type-checking $APP/ as committed…"
      OUT=$(cd "$TMP/$APP" && "$TSC" --noEmit 2>&1)
      RC=$?
      if [ $RC -ne 0 ]; then
        FAILED=1
        say ""
        say "${R}${B}GATE 2 FAILED — the committed tree does not type-check${X}"
        say ""
        printf '%s\n' "$OUT" | sed 's/^/    /' >&2
        say ""
        say "  This is the exact error Vercel is about to print. If the same"
        say "  command passes in your working tree, the difference is a file you"
        say "  have on disk and have not committed."
      else
        say "  ${G}committed tree type-checks${X}"
      fi
    fi
  fi
fi

# =============================================================================
# GATE 3 — tests, opt-in
# =============================================================================
if [ "${PREPUSH_TESTS:-}" = "1" ]; then
  say ""
  say "  running tests (PREPUSH_TESTS=1)…"
  if ! (cd "$ROOT/$APP" && npm test --silent >/dev/null 2>&1); then
    FAILED=1
    say "${R}${B}GATE 3 FAILED — tests are red${X}  (run: cd $APP && npm test)"
  else
    say "  ${G}tests pass${X}"
  fi
fi

say ""
if [ $FAILED -ne 0 ]; then
  say "${R}${B}push blocked.${X}  Override with: ${B}git push --no-verify${X}"
  say ""
  exit 1
fi

say "${G}${B}ok — pushing $SHORT${X}"
say ""
exit 0
