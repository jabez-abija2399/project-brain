#!/usr/bin/env bash
# Stack-agnostic verification gate. Auto-detects Node, Go, Python, Rust; override in scripts/verify.config.
# Never reports a skipped step as passed. Full tool output goes to agent/last-verify.log (not into the chat);
# a failing step prints only its last lines.
#   bash scripts/verify.sh           full gate (required before `kit.py pass` and before commit)
#   bash scripts/verify.sh --quick   fast inner loop: typecheck, lint, tests; stops at the first failure.
#                                    Writes RESULT=QUICK_*, which `kit.py pass` and the commit hook do NOT accept.
# VERIFY_STRICT=1 (use in CI) turns skipped security scanners into failures. VERIFY_PARALLEL=0 runs scanners serially.
# VERIFY_CI_ONLY="build e2e audit scanners perf mutation" (any subset) runs those steps only when CI is set.
# Optional steps (off until configured): VERIFY_PERF (performance budget), VERIFY_MUTATION (do tests catch bugs?).
set -u
cd "$(dirname "$0")/.."
QUICK=0; [ "${1:-}" = "--quick" ] && QUICK=1
[ -f scripts/verify.config ] && . scripts/verify.config
mkdir -p agent agent/.verify; rm -f agent/.verify/*
START=$(python3 -c "import time; print(time.time())")
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
record() { # record NAME FILE RC
  { echo "== $1"; cat "$2"; } >> "$LOG"
  if [ "$3" = 0 ]; then SUMMARY+=("PASS  $1"); else SUMMARY+=("FAIL  $1"); FAIL=1; show_tail "$1" "$2"; fi
}
run() { # run NAME COMMAND
  local name="$1" cmd="$2" f
  if [ -z "$cmd" ] || [ "$cmd" = "SKIP" ]; then SUMMARY+=("SKIP  $name (not configured)"); return; fi
  [ "$QUICK" = 1 ] && [ "$FAIL" = 1 ] && { SUMMARY+=("----  $name (not run: --quick stops at first failure)"); return; }
  f="agent/.verify/$(slug "$name").out"; echo "\$ $cmd" > "$f"
  bash -c "$cmd" >> "$f" 2>&1; record "$name" "$f" $?
}
run_bg() { # run_bg NAME COMMAND : independent steps (scanners, audit) run concurrently; collected by wait_bg
  local name="$1" cmd="$2" f
  if [ -z "$cmd" ] || [ "$cmd" = "SKIP" ]; then SUMMARY+=("SKIP  $name (not configured)"); return; fi
  if [ "${VERIFY_PARALLEL:-1}" = 0 ]; then run "$name" "$cmd"; return; fi
  f="agent/.verify/$(slug "$name").out"; echo "\$ $cmd" > "$f"
  ( bash -c "$cmd" >> "$f" 2>&1; echo $? > "$f.rc" ) &
  BG+=("$name")
}
wait_bg() {
  wait
  local name f
  for name in ${BG[@]+"${BG[@]}"}; do f="agent/.verify/$(slug "$name").out"; record "$name" "$f" "$(cat "$f.rc" 2>/dev/null || echo 1)"; done
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


if [ "$QUICK" = 1 ]; then
  run "typecheck" "${VERIFY_TYPECHECK:-}"
  run "lint"      "${VERIFY_LINT:-}"
  run "unit/integration tests" "${VERIFY_TEST_QUICK:-${VERIFY_TEST:-}}"
  run "kit guard" "python3 scripts/kit.py check"
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
  FAIL=1; SUMMARY+=("FAIL  no test command configured: tests are mandatory (set VERIFY_TEST in scripts/verify.config)")
fi

echo "================ VERIFY SUMMARY$([ "$QUICK" = 1 ] && echo ' (--quick)') ================"
printf '%s\n' "${SUMMARY[@]}"
[ ${#OFF[@]} -gt 0 ] && echo "OFF   opt-in (scripts/verify.config): ${OFF[*]}"
if [ "$SKIPPED_SEC" = 1 ] && [ "${VERIFY_STRICT:-0}" = 1 ]; then FAIL=1; echo "STRICT: skipped security scanners count as failure"; fi
NSKIP=$(printf '%s\n' "${SUMMARY[@]}" | grep -c '^SKIP' || true)
RESULT=PASS; [ "$FAIL" = 1 ] && RESULT=FAIL; [ "$QUICK" = 1 ] && RESULT="QUICK_$RESULT"
printf 'RESULT=%s\nTIME=%s\nSKIPPED=%s\n' "$RESULT" "$START" "$NSKIP" > agent/last-verify.txt
echo "RESULT: $RESULT  (skipped: $NSKIP; opt-in off: ${#OFF[@]}; SKIP/OFF = NOT verified$([ "$QUICK" = 1 ] && echo '; quick result does not count for kit.py pass or commit'))"
[ "$FAIL" = 0 ]
