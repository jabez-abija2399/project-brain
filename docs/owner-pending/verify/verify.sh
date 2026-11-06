#!/usr/bin/env bash
# Stack-agnostic verification gate. Auto-detects Node, Go, Python, Rust; override in scripts/verify.config.
# Never reports a skipped step as passed. Full tool output goes to agent/last-verify.log (not into the chat);
# a failing step prints only its last lines. Every step prints how long it took.
#   bash scripts/verify.sh           full gate (required before `kit.py pass` and before a pull request)
#   bash scripts/verify.sh --quick   fast inner loop: typecheck and lint for the packages changed since the base (default
#                                    origin/main) and the packages that depend on them; tests only for the changed packages
#                                    themselves (dependents' tests run in the full gate and in CI). Docs-only and
#                                    agent/*.md-only changes skip typecheck and tests. Writes RESULT=QUICK_*, which
#                                    `kit.py pass` and the commit hook do NOT accept.
# VERIFY_BASE=<ref> sets the base for --quick (default origin/main).
# VERIFY_STRICT=1 (use in CI) turns skipped security scanners into failures. VERIFY_PARALLEL=0 runs scanners serially.
# VERIFY_CI_ONLY="build e2e audit scanners perf mutation" (any subset) runs those steps only when CI is set.
# Optional steps (off until configured): VERIFY_PERF (performance budget), VERIFY_MUTATION (do tests catch bugs?).
set -u
cd "$(dirname "$0")/.."
QUICK=0; [ "${1:-}" = "--quick" ] && QUICK=1
[ -f scripts/verify.config ] && . scripts/verify.config
mkdir -p agent agent/.verify; rm -f agent/.verify/*
now_ms() { # milliseconds now, for timing only (never a pass or fail input)
  if [ -n "${EPOCHREALTIME:-}" ]; then local s="${EPOCHREALTIME%.*}" f="${EPOCHREALTIME#*.}"; echo $((s * 1000 + 10#${f:0:3}))
  else python3 -c 'import time; print(int(time.time() * 1000))'; fi
}
fmt_ms() { awk -v ms="$1" 'BEGIN { printf "%.1f s", ms / 1000 }'; }
START=$(python3 -c "import time; print(time.time())")
START_MS=$(now_ms)
LOG=agent/last-verify.log; : > "$LOG"
SUMMARY=(); FAIL=0; SKIPPED_SEC=0; OFF=(); BG=()
TAIL_LINES="${VERIFY_TAIL:-25}"
have() { command -v "$1" >/dev/null 2>&1; }
has_script() { grep -Eq "\"$1\"[[:space:]]*:" package.json 2>/dev/null; }
slug() { echo "$1" | tr -c 'A-Za-z0-9\n' '_'; }

show_tail() { # show_tail NAME FILE : the useful end of a failing step, so nobody has to open the whole log
  echo "---- $1 (last $TAIL_LINES lines; full output in $LOG) ----"
  grep -v '^[[:space:]]*$' "$2" | tail -n "$TAIL_LINES"
}
record() { # record NAME FILE RC [MS]
  { echo "== $1"; cat "$2"; } >> "$LOG"
  local took=""; [ -n "${4:-}" ] && took=" ($(fmt_ms "$4"))"
  if [ "$3" = 0 ]; then SUMMARY+=("PASS  $1$took"); else SUMMARY+=("FAIL  $1$took"); FAIL=1; show_tail "$1" "$2"; fi
}
run() { # run NAME COMMAND
  local name="$1" cmd="$2" f
  if [ -z "$cmd" ] || [ "$cmd" = "SKIP" ]; then SUMMARY+=("SKIP  $name (not configured)"); return; fi
  [ "$QUICK" = 1 ] && [ "$FAIL" = 1 ] && { SUMMARY+=("----  $name (not run: --quick stops at first failure)"); return; }
  f="agent/.verify/$(slug "$name").out"; echo "\$ $cmd" > "$f"
  local t0; t0=$(now_ms)
  bash -c "$cmd" >> "$f" 2>&1; local rc=$?
  record "$name" "$f" "$rc" "$(( $(now_ms) - t0 ))"
}
run_bg() { # run_bg NAME COMMAND : independent steps (scanners, audit) run concurrently; collected by wait_bg
  local name="$1" cmd="$2" f
  if [ -z "$cmd" ] || [ "$cmd" = "SKIP" ]; then SUMMARY+=("SKIP  $name (not configured)"); return; fi
  if [ "${VERIFY_PARALLEL:-1}" = 0 ]; then run "$name" "$cmd"; return; fi
  f="agent/.verify/$(slug "$name").out"; echo "\$ $cmd" > "$f"
  ( t0=$(now_ms); bash -c "$cmd" >> "$f" 2>&1; echo $? > "$f.rc"; echo $(( $(now_ms) - t0 )) > "$f.ms" ) &
  BG+=("$name")
}
wait_bg() {
  wait
  local name f
  for name in ${BG[@]+"${BG[@]}"}; do
    f="agent/.verify/$(slug "$name").out"
    record "$name" "$f" "$(cat "$f.rc" 2>/dev/null || echo 1)" "$(cat "$f.ms" 2>/dev/null || echo "")"
  done
  BG=()
}
run_opt() { # run_opt NAME COMMAND ENVVAR : optional steps show OFF (not SKIP) and never count as skipped
  if [ -z "$2" ] || [ "$2" = "SKIP" ]; then OFF+=("$3"); return; fi
  run "$1" "$2"
}
cionly() { # cionly KEY : true when KEY is listed in VERIFY_CI_ONLY and we are not in CI
  [ -z "${CI:-}" ] && case " ${VERIFY_CI_ONLY:-} " in *" $1 "*) return 0;; esac; return 1
}
ci_note() { SUMMARY+=("CI    $1 (runs in CI only; VERIFY_CI_ONLY)"); }
sec() { # sec NAME TOOL COMMAND INSTALL_HINT
  if have "$2"; then run_bg "$1" "$3"
  else SUMMARY+=("SKIP  $1 (not installed: $4)"); SKIPPED_SEC=1; fi
}

# ---- what changed (quick mode works from this list only) ----
BASE="${VERIFY_BASE:-origin/main}"
CHANGED=$( { git diff --name-only "$BASE"...HEAD 2>/dev/null
             git diff --name-only HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null
             git ls-files --others --exclude-standard 2>/dev/null; } | sort -u | sed '/^$/d')
BASE_OK=0; git rev-parse -q --verify "$BASE^{commit}" >/dev/null 2>&1 && BASE_OK=1
# Docs-only means: something changed, and every change is under docs/, an agent/*.md file, or a top-level *.md file.
# Markdown inside apps/ or packages/ (e.g. generated plugin files) is code for this purpose. No usable base means we
# cannot tell what changed, so it is never docs-only.
DOCS_ONLY=1; [ -z "$CHANGED" ] && DOCS_ONLY=0; [ "$BASE_OK" = 0 ] && DOCS_ONLY=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in docs/*|agent/*.md) ;; */*) DOCS_ONLY=0 ;; *.md) ;; *) DOCS_ONLY=0 ;; esac
done <<< "$CHANGED"
# Quick mode with no usable base runs everything (never guesses what changed).
[ "$QUICK" = 1 ] && [ "$BASE_OK" = 0 ] && QUICK_FULL_REASON="base $BASE not found: running every package"
[ "$QUICK" = 1 ] && [ "$BASE_OK" = 1 ] && [ -z "$CHANGED" ] && QUICK_FULL_REASON="nothing changed since $BASE: running every package"
# Root files (tsconfig, biome, lockfile, scripts) can affect every package: typecheck everything in that case.
if [ "$QUICK" = 1 ] && printf '%s\n' "$CHANGED" | grep -Eqv '^(apps|packages)/|^docs/|^agent/.*\.md$|^[^/]*\.md$|^$'; then
  QUICK_FULL_REASON="${QUICK_FULL_REASON:-files outside apps/ and packages/ changed: running every package}"
fi

# ---- detect stack defaults (only if not set in verify.config) ----
if [ -f package.json ]; then
  pm=npm; [ -f pnpm-lock.yaml ] && pm=pnpm; [ -f yarn.lock ] && pm=yarn; { [ -f bun.lockb ] || [ -f bun.lock ]; } && pm=bun
  has_script typecheck && : "${VERIFY_TYPECHECK=$pm run typecheck}"
  [ -z "${VERIFY_TYPECHECK+x}" ] && [ -f tsconfig.json ] && have npx && VERIFY_TYPECHECK="npx tsc --noEmit"
  has_script lint && : "${VERIFY_LINT=$pm run lint}"
  has_script test && : "${VERIFY_TEST=$pm run test}"
  has_script build && : "${VERIFY_BUILD=$pm run build}"
  has_script "test:e2e" && : "${VERIFY_E2E=$pm run test:e2e}"
  # audit must match the lockfile; yarn/bun have no compatible audit (osv-scanner covers them)
  case $pm in
    npm)  : "${VERIFY_AUDIT=npm audit --audit-level=high --omit=dev}" ;;
    pnpm) : "${VERIFY_AUDIT=pnpm audit --audit-level=high --prod}" ;;
  esac
fi
if [ -f go.mod ]; then
  : "${VERIFY_TYPECHECK=go vet ./...}"; : "${VERIFY_TEST=go test -v ./...}"; : "${VERIFY_BUILD=go build ./...}"
  have golangci-lint && : "${VERIFY_LINT=golangci-lint run}"
  have govulncheck && : "${VERIFY_AUDIT=govulncheck ./...}"
fi
if [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ]; then
  # the kit's own Python files are not part of the project: keep them out of lint/typecheck
  have ruff && : "${VERIFY_LINT=ruff check . --extend-exclude scripts/kit.py,.claude}"
  if have pyright; then : "${VERIFY_TYPECHECK=pyright}"; elif have mypy; then : "${VERIFY_TYPECHECK=mypy . --exclude '^(scripts/kit\.py|\.claude/)'}"; fi
  have pytest && : "${VERIFY_TEST=pytest -v}"
  have pip-audit && : "${VERIFY_AUDIT=pip-audit}"
fi
if [ -f Cargo.toml ]; then
  : "${VERIFY_TYPECHECK=cargo check}"; : "${VERIFY_LINT=cargo clippy -- -D warnings}"
  : "${VERIFY_TEST=cargo test}"; : "${VERIFY_BUILD=cargo build}"
  have cargo-audit && : "${VERIFY_AUDIT=cargo audit}"
fi

# quick_plan: one line per workspace package in the changed set or depending on it: "DIR NAME changed|dependent".
# Read from the workspace's own package.json files, so it does not depend on pnpm's output format.
quick_plan() {
  CHANGED_LIST="$CHANGED" node -e '
const fs = require("fs"), path = require("path");
const dirs = [];
for (const g of ["apps", "packages"]) if (fs.existsSync(g)) for (const d of fs.readdirSync(g)) {
  const p = path.join(g, d); if (fs.existsSync(path.join(p, "package.json"))) dirs.push(p);
}
const info = {};
for (const d of dirs) {
  const j = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8"));
  info[d] = { name: j.name, deps: Object.keys({ ...j.dependencies, ...j.devDependencies }) };
}
const byName = {}; for (const d of dirs) byName[info[d].name] = d;
const files = (process.env.CHANGED_LIST || "").split("\n").filter(Boolean);
const changed = new Set(dirs.filter((d) => files.some((f) => f === d || f.startsWith(d + "/"))));
const selected = new Set(changed);
for (let grew = true; grew; ) {
  grew = false;
  for (const d of dirs) {
    if (selected.has(d)) continue;
    if (info[d].deps.some((n) => byName[n] && selected.has(byName[n]))) { selected.add(d); grew = true; }
  }
}
for (const d of dirs) if (selected.has(d)) console.log(d + " " + info[d].name + " " + (changed.has(d) ? "changed" : "dependent"));
'
}

# quick_tests: the test step of --quick (see the comment in the quick branch below).
quick_tests() {
  local plan; plan=$(quick_plan)
  if [ -z "$plan" ]; then
    run "tests (no workspace package changed: every test)" "${VERIFY_TEST:-}"; return
  fi
  # Changed files outside apps/ and packages/ (root config, lockfile, scripts) can affect anything: run every test.
  if printf '%s\n' "$CHANGED" | grep -Eqv '^(apps|packages)/|^(docs/|agent/|.*\.md$)|^$'; then
    run "tests (files outside the packages changed: every test)" "${VERIFY_TEST:-}"; return
  fi
  local dir name kind
  while read -r dir name kind; do
    [ -z "${dir:-}" ] && continue
    # Only packages whose own files changed run tests in quick mode. Dependents get typecheck and lint (above), not tests:
    # their tests run in the full gate and in CI.
    if [ "$kind" = changed ]; then
      run "tests $name (changed package: all)" "pnpm --filter \"$name\" --if-present run test -- --reporter=verbose"
    fi
  done <<< "$plan"
}

if [ "$QUICK" = 1 ]; then
  if [ "$DOCS_ONLY" = 1 ]; then
    SUMMARY+=("SKIP  typecheck, tests (quick: only docs or agent/*.md changed)")
    run "kit guard" "python3 scripts/kit.py check"
  else
    if [ -n "${QUICK_FULL_REASON:-}" ]; then SUMMARY+=("NOTE  $QUICK_FULL_REASON"); fi
    # Changed packages and their dependents, from pnpm's own filter: "...[ref]" = what changed since ref, plus dependents.
    # The root package is left out: its scripts run the whole workspace, which is what quick mode avoids.
    ROOT_NAME=$(node -p "require('./package.json').name" 2>/dev/null || echo "")
    if [ -n "${QUICK_FULL_REASON:-}" ] || [ "$pm" != pnpm ] || [ -z "$ROOT_NAME" ]; then
      run "typecheck" "${VERIFY_TYPECHECK:-}"; run "lint" "${VERIFY_LINT:-}"
      run "unit/integration tests" "${VERIFY_TEST:-}"
    else
      run "typecheck (changed packages and dependents)" \
        "pnpm --filter \"...[$BASE]\" --filter \"!$ROOT_NAME\" --if-present run typecheck"
      run "lint" "${VERIFY_LINT:-}"
      # Tests, quick version:
      #  - a changed package runs all of its own tests (its @slow tests too, since the package changed);
      #  - a dependent package runs no tests here (typecheck and lint only); if files in it changed, it is a changed
      #    package itself and runs all its tests (owner decision, 2026-11-06);
      #  - changes outside apps/ and packages/ (root config, lockfile, scripts) fall back to every test in the workspace.
      quick_tests
    fi
    run "kit guard" "python3 scripts/kit.py check"
  fi
else
  # scanners and audit are independent of the build: start them first, collect after the serial steps
  if cionly audit; then ci_note "dependency audit"; else run_bg "dependency audit" "${VERIFY_AUDIT:-}"; fi
  if cionly scanners; then ci_note "security scanners (gitleaks, semgrep, osv-scanner)"; else
  sec "secret scan (gitleaks)"  gitleaks "${VERIFY_GITLEAKS:-gitleaks detect --no-banner --redact}" "https://github.com/gitleaks/gitleaks"
  sec "SAST (semgrep)"          semgrep  "${VERIFY_SEMGREP:-semgrep scan --config auto --error --quiet}" "pip install semgrep"
  sec "vuln scan (osv-scanner)" osv-scanner "${VERIFY_OSV:-osv-scanner scan source -r .}" "https://github.com/google/osv-scanner"
  fi
  run "typecheck" "${VERIFY_TYPECHECK:-}"
  run "lint"      "${VERIFY_LINT:-}"
  run "unit/integration tests" "${VERIFY_TEST:-}"
  if cionly build; then ci_note "build"; else run "build" "${VERIFY_BUILD:-}"; fi
  if cionly e2e; then ci_note "e2e"; else run "e2e" "${VERIFY_E2E:-}"; fi
  if cionly perf; then [ -n "${VERIFY_PERF:-}" ] && ci_note "performance budget"; else run_opt "performance budget" "${VERIFY_PERF:-}" VERIFY_PERF; fi
  if cionly mutation; then [ -n "${VERIFY_MUTATION:-}" ] && ci_note "mutation testing"; else run_opt "mutation testing" "${VERIFY_MUTATION:-}" VERIFY_MUTATION; fi
  wait_bg
  run "kit guard" "python3 scripts/kit.py check"
fi
if [ -z "${VERIFY_TEST:-}" ] || [ "${VERIFY_TEST:-}" = "SKIP" ]; then
  if [ "$QUICK" = 1 ] && [ "$DOCS_ONLY" = 1 ]; then :; else
  FAIL=1; SUMMARY+=("FAIL  no test command configured: tests are mandatory (set VERIFY_TEST in scripts/verify.config)"); fi
fi

TOTAL_MS=$(( $(now_ms) - START_MS ))
echo "================ VERIFY SUMMARY$([ "$QUICK" = 1 ] && echo ' (--quick)') ================"
printf '%s\n' "${SUMMARY[@]}"
[ ${#OFF[@]} -gt 0 ] && echo "OFF   opt-in (scripts/verify.config): ${OFF[*]}"
echo "TOTAL $(fmt_ms "$TOTAL_MS")  (base $BASE; $([ "$QUICK" = 1 ] && [ "$DOCS_ONLY" = 1 ] && echo 'docs-only change' || echo "$(printf '%s\n' "$CHANGED" | sed '/^$/d' | wc -l | tr -d ' ') changed file(s)"))"
if [ "$SKIPPED_SEC" = 1 ] && [ "${VERIFY_STRICT:-0}" = 1 ]; then FAIL=1; echo "STRICT: skipped security scanners count as failure"; fi
NSKIP=$(printf '%s\n' "${SUMMARY[@]}" | grep -c '^SKIP' || true)
RESULT=PASS; [ "$FAIL" = 1 ] && RESULT=FAIL; [ "$QUICK" = 1 ] && RESULT="QUICK_$RESULT"
printf 'RESULT=%s\nTIME=%s\nSKIPPED=%s\nDURATION_MS=%s\n' "$RESULT" "$START" "$NSKIP" "$TOTAL_MS" > agent/last-verify.txt
echo "RESULT: $RESULT  (skipped: $NSKIP; opt-in off: ${#OFF[@]}; SKIP/OFF = NOT verified$([ "$QUICK" = 1 ] && echo '; quick result does not count for kit.py pass or commit'))"
[ "$FAIL" = 0 ]
