#!/usr/bin/env python3
"""AI Build Kit tool. Python 3.8+, standard library only. Stack-agnostic. Works with Claude Code, OpenCode,
Antigravity, Codex, Cursor, Gemini CLI or any agent that can run a shell command.

  New project / setup
  python3 scripts/kit.py init [--name "My App"] [--stack auto] [--mode fast|strict]   fill placeholders, git, hooks
  python3 scripts/kit.py config [--stack PRESET] [--mode fast|strict]   show or rewrite scripts/verify.config
  python3 scripts/kit.py doctor              check tools, hooks, placeholders, plan (run when something feels off)
  python3 scripts/kit.py import [agent/plan.json] [--dry-run] [--keep]   add/update features from an approved plan
  python3 scripts/kit.py upgrade /path/to/newer-kit [--dry-run]   copy kit-owned files from a newer kit version
  python3 scripts/kit.py harden [--days 3]    dependency cooldown: never install package versions younger than N days
  python3 scripts/kit.py hooks               which agents have the guard hooks (+ the Codex one-time setup)
  python3 scripts/kit.py sync-skills         copy .agents/skills -> .claude/skills after editing a skill
  python3 scripts/kit.py stop-check          used by the Stop hook: refuses to stop with a half-finished feature
  python3 scripts/kit.py version

  Daily
  python3 scripts/kit.py brief               compact session brief (status, directives, last progress)
  python3 scripts/kit.py status              feature / acceptance-criteria matrix
  python3 scripts/kit.py show [FEAT-001]     one feature's criteria (default: in-progress); never read features.json whole
  python3 scripts/kit.py where <FEAT-001|AC-001-01|symbol>   only the map lines you need (path:line)
  python3 scripts/kit.py dupes               repeated code blocks (reuse instead of copy)
  python3 scripts/kit.py start FEAT-001      mark a feature in_progress (dependencies must be done)
  python3 scripts/kit.py pass AC-001-01 [--evidence "..."] [--manual]
  python3 scripts/kit.py fail AC-001-01
  python3 scripts/kit.py done FEAT-001       mark done (every criterion must pass)
  python3 scripts/kit.py block FEAT-001 "reason"
  python3 scripts/kit.py check [--commit]    guard checks (also run by verify.sh and the pre-commit hook)
  python3 scripts/kit.py dep-check <package> [--eco npm|pypi|crates|go]   does it exist? how old/maintained? (run BEFORE adding)
  python3 scripts/kit.py review-pack [BASE] [--feat FEAT-001]   build agent/review-pack.md for an independent reviewer
"""
import fnmatch, json, os, re, shutil, subprocess, sys, time
from functools import lru_cache
from pathlib import Path

KIT_VERSION = "4.1.0"
ROOT = Path(__file__).resolve().parent.parent
RS = str(ROOT)
AGENT = ROOT / "agent"
FEATURES = AGENT / "features.json"
VERIFY = AGENT / "last-verify.txt"
VERIFY_LOG = AGENT / "last-verify.log"
SYMBOL_CACHE = AGENT / ".symbols-cache.json"
STATUSES = {"todo", "in_progress", "blocked", "done"}
IGNORE_DIRS = {".git", "node_modules", "dist", "build", ".next", ".nuxt", "out", "vendor", "target",
               "__pycache__", ".venv", "venv", "coverage", ".turbo", ".cache", "bin", "obj", ".idea", ".vscode"}
ARTIFACT_TOP = {"test-results", "playwright-report", "blob-report", ".lighthouseci", ".stryker-tmp", "reports", "htmlcov",
                ".nyc_output", ".pytest_cache", ".mypy_cache", ".ruff_cache", "storybook-static", ".hypothesis", ".tox"}
ARTIFACT_SUFFIX = (".tsbuildinfo", ".log", ".pyc", ".lcov")
LOCKFILES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock", "go.sum",
             "poetry.lock", "uv.lock", "Cargo.lock", "Gemfile.lock", "composer.lock"}
# Guard files: agents may not change them (Claude/Cursor/Gemini/Copilot hooks + pre-commit + CI). Human: GUARD_ADMIN=1.
PROTECTED = ["scripts/kit.py", "scripts/verify.sh", "scripts/install-hooks.sh", "scripts/verify.config",
             ".claude/settings.json", ".claude/hooks/*", ".claude/agents/evaluator.md", ".githooks/*",
             ".cursor/hooks.json", ".gemini/settings.json", ".github/hooks/*", ".npmrc", "uv.toml", "bunfig.toml"]
# Strict mode: only an evaluator/reviewer session (human starts it with KIT_ROLE=evaluator) may write these.
ROLE_FILES = ["agent/evaluations/*", "agent/reviews/*"]
ROLES = {"evaluator", "reviewer"}
ASSERT_RX = re.compile(r"\b(assert\w*|expect\s*\(|should\b|t\.(Error|Errorf|Fatal|Fatalf|Fail)\b|require\.\w+\(|"
                       r"assert_eq!|assert_ne!|self\.assert\w+|\.to(Be|Equal|Have|Throw|Match|Contain|StrictEqual))")
TEST_CONFIG = re.compile(r"(^|/)(vitest|vite|jest|playwright|karma|cypress)\.config\.\w+$|(^|/)(pytest\.ini|conftest\.py|tox\.ini|"
                         r"setup\.cfg|\.mocharc\.\w+|jest\.setup\.\w+|package\.json|pyproject\.toml|Cargo\.toml)$")
WEAKEN_RX = re.compile(r"exclude|ignore|skip|passWithNoTests|deselect|collect_ignore|xfail|testPathIgnore|norecursedirs|"
                       r"--bail|-k\s|maxfail|continue-on-error|allow_failure", re.I)
COOLDOWN = {".npmrc": "min-release-age", "pnpm-workspace.yaml": "minimumReleaseAge", "bunfig.toml": "minimumReleaseAge",
            "uv.toml": "exclude-newer"}
KINDS = {"happy", "negative", "boundary", "permission", "attack", "state", "perf"}
ROBUST_KINDS = {"negative", "boundary", "permission", "attack"}
MANIFESTS = {"package.json", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile", "composer.json", "pom.xml",
             "build.gradle", "build.gradle.kts"}
SRC_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php",
           ".cs", ".swift", ".vue", ".svelte", ".dart", ".ex", ".exs", ".scala"}
UI_EXT = {".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".html"}
TEST_SKIP = [r"\.skip\(", r"\bxit\(", r"\bxdescribe\(", r"\bit\.todo\(", r"\btest\.fixme\(", r"\btest\.skip\b",
             r"@pytest\.mark\.(skip|xfail)", r"\bpytest\.skip\(", r"\bt\.Skip(Now)?\(", r"#\[ignore\]",
             r"@Disabled\b", r"@Ignore\b", r"\b(?:it|test|describe)\.only\(", r"\bf(?:it|describe)\(",
             r"\.skipIf\(\s*true\b"]
SUPPRESS = [r"eslint-disable", r"@ts-ignore", r"@ts-expect-error", r"#\s*noqa", r"//\s*nolint",
            r"#\s*type:\s*ignore", r"#\s*pylint:\s*disable", r"#\s*nosec", r"//\s*nosemgrep", r"#\s*nosemgrep"]
NOT_SCANNED = ("scripts/", ".claude/", ".githooks/", "docs/", "agent/", ".github/")


# ---------- helpers ----------
def die(msg, code=2):
    print(msg, file=sys.stderr)
    sys.exit(code)


def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout
    except FileNotFoundError:
        return ""


def in_git():
    return (ROOT / ".git").exists()


def has_head():
    return in_git() and subprocess.run(["git", "rev-parse", "--verify", "-q", "HEAD"], cwd=ROOT,
                                       capture_output=True).returncode == 0


def base_ref():
    return os.environ.get("KIT_BASE") or "HEAD"


def read(p, limit=300_000):
    try:
        return (ROOT / p).read_text(errors="ignore")[:limit]
    except Exception:
        return ""



def is_test(p):
    return bool(re.search(r"(^|/)(tests?|__tests__|spec|e2e|cypress|playwright)(/|$)|(_test\.|\.test\.|\.spec\.)|(^|/)test_[^/]*\.py$", p))


@lru_cache(maxsize=None)
def list_files():
    if in_git():
        files = [f for f in git("ls-files", "-co", "--exclude-standard").splitlines() if f]
    else:
        files = []
        for dp, dn, fn in os.walk(ROOT):
            dn[:] = [d for d in dn if d not in IGNORE_DIRS]
            files += [str(Path(dp, f).relative_to(ROOT)) for f in fn]
    return tuple(f for f in files if IGNORE_DIRS.isdisjoint(f.split("/")) and os.path.isfile(os.path.join(RS, f)))


def changed_files():
    """[(status, path)] of files changed vs working tree (or vs KIT_BASE in CI)."""
    if not in_git():
        return []
    res = []
    if os.environ.get("KIT_BASE"):
        for l in git("diff", "--name-status", f"{os.environ['KIT_BASE']}...HEAD").splitlines():
            parts = l.split("\t")
            if len(parts) >= 2:
                res.append((parts[0][0], parts[-1]))
        return res
    for l in git("status", "--porcelain", "-uall").splitlines():
        if len(l) < 4:
            continue
        p = l[3:].split(" -> ")[-1].strip('"')
        st = "D" if "D" in l[:2] else ("??" if l[:2] == "??" else "M")
        res.append((st, p))
    return res


def _diff_args():
    return ["diff", base_ref() + ("...HEAD" if os.environ.get("KIT_BASE") else ""), "-U0", "--no-color"]


def removed_lines(changed):
    """[(path, line)] of lines removed vs base (tracked files only)."""
    res, cur = [], None
    if not has_head():
        return res
    for l in git(*_diff_args()).splitlines():
        if l.startswith("--- a/"):
            cur = l[6:]
        elif l.startswith("--- "):
            cur = None
        elif l.startswith("-") and not l.startswith("---") and cur:
            res.append((cur, l[1:]))
    return res


def added_line_numbers(path, status):
    """Set of line numbers (1-based) added in this file vs base; all lines for new files."""
    if status == "??" or not has_head():
        return set(range(1, read(path).count("\n") + 2))
    nums = set()
    for l in git(*_diff_args(), "--", path).splitlines():
        m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", l)
        if m:
            start, n = int(m.group(1)), int(m.group(2) or 1)
            nums.update(range(start, start + n))
    return nums


def tests_passed(log_text):
    """Number of passing tests in a verify log (pytest, vitest, jest, mocha, cargo, go)."""
    n = 0
    for l in log_text.splitlines():
        if re.search(r"Test Files|Test Suites|Suites:", l):
            continue
        n += sum(int(x) for x in re.findall(r"\b(\d+) (?:passed|passing)\b", l))
    n += len(re.findall(r"^\s*--- PASS", log_text, re.M))
    return n


def added_lines(changed):
    """[(path, line)] of added lines vs base, including whole untracked/new files."""
    res = []
    if has_head():
        cur = None
        args = ["diff", base_ref() + ("...HEAD" if os.environ.get("KIT_BASE") else ""), "-U0", "--no-color"]
        for l in git(*args).splitlines():
            if l.startswith("+++ b/"):
                cur = l[6:]
            elif l.startswith("+++ "):
                cur = None
            elif l.startswith("+") and cur:
                res.append((cur, l[1:]))
    for st, p in changed:
        if (st == "??" or not has_head()) and st != "D" and (ROOT / p).is_file():
            res += [(p, ln) for ln in read(p).splitlines()]
    return res


def load():
    if not FEATURES.exists():
        die("agent/features.json is missing")
    try:
        return json.loads(FEATURES.read_text())
    except json.JSONDecodeError as e:
        die(f"agent/features.json is not valid JSON: {e}")


def save(d):
    FEATURES.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")


def verify_state():
    if not VERIFY.exists():
        return None
    kv = {}
    for l in VERIFY.read_text().splitlines():
        if "=" in l:
            k, v = l.split("=", 1)
            kv[k.strip()] = v.strip()
    try:
        kv["TIME"] = float(kv.get("TIME", "0"))
    except ValueError:
        kv["TIME"] = 0.0
    return kv


def is_kit_file(p):
    """Kit tooling, not product code: changing it never makes the product's verify result stale."""
    return p == ".gitignore" or any(fnmatch.fnmatch(p, g) for g in PROTECTED + KIT_OWNED)


@lru_cache(maxsize=None)
def newest_source_mtime():
    m = 0.0
    for f in list_files():
        if (f.startswith(("agent/", "docs/")) or f.endswith(".md") or f.endswith(ARTIFACT_SUFFIX) or is_kit_file(f)
                or f.startswith(".github/") or (f in UPGRADE_ADDS and (f != "scripts/dev.sh" or "KICKOFF_FILLS_THIS" in read(f)))
                or f.split("/", 1)[0] in ARTIFACT_TOP or os.path.basename(f) in LOCKFILES):
            continue
        try:
            m = max(m, os.stat(os.path.join(RS, f)).st_mtime)
        except OSError:
            pass
    return m


def ago(t):
    s = int(time.time() - t)
    return f"{s // 60}m ago" if s < 3600 else f"{s // 3600}h ago" if s < 172800 else f"{s // 86400}d ago"


def ac_re(aid):
    """Regex for a criterion ID in any spelling (AC-003-01, AC_003_01, ac00301) that does NOT match AC-003-010."""
    parts = re.findall(r"[A-Za-z]+|\d+", aid)
    return re.compile(r"(?<![A-Za-z0-9])" + r"[\W_]*".join(map(re.escape, parts)) + r"(?!\d)", re.I)


@lru_cache(maxsize=None)
def test_corpus():
    """All test file contents, read once per process and only when needed."""
    return "\n\0\n".join(read(f) for f in list_files() if is_test(f))


def in_tests(aid):
    return bool(ac_re(aid).search(test_corpus()))


def recorded(name, text):
    """Is a dependency name recorded in the decisions text? Word-boundary match ('react' is not satisfied by 'reactive')."""
    return bool(re.search(r"(?<![\w@/.\-])" + re.escape(name.lower()) + r"(?![\w\-])", text))


def config_vals():
    """KEY="value" pairs from scripts/verify.config (simple parser; the file is also sourced by bash)."""
    kv = {}
    for l in read("scripts/verify.config").splitlines():
        m = re.match(r'\s*([A-Z_][A-Z0-9_]*)=(?:"([^"]*)"|\'([^\']*)\'|(\S*))', l)
        if m:
            kv[m.group(1)] = next((g for g in m.groups()[1:] if g is not None), "")
    return kv


def kit_mode():
    return (os.environ.get("KIT_MODE") or config_vals().get("KIT_MODE") or "fast").lower()


def feats(d):
    return d.get("features", [])


def find_ac(d, aid):
    for f in feats(d):
        for a in f.get("acceptance", []):
            if a["id"] == aid:
                return f, a
    return None, None


# ---------- check ----------
def done_blockers(f):
    """Reasons a feature may not be marked done (used by `done` and by `check`)."""
    out = []
    acs = f.get("acceptance", [])
    bad = [a["id"] for a in acs if not a.get("passes")]
    if bad:
        out.append(f"PARTIALLY IMPLEMENTED. Criteria not passing: {', '.join(bad)}")
    kinds = {a.get("kind", "happy") for a in acs}
    if not (kinds & ROBUST_KINDS) and not f.get("waive_robust"):
        out.append("no negative/boundary/permission/attack criterion (add one; only the human may set waive_robust)")
    if f.get("security_sensitive") and not (kinds & {"attack", "permission"}):
        out.append("security_sensitive feature needs a permission or attack criterion (e.g. 'user A cannot read user B's data')")
    if f.get("review_required") or (f.get("security_sensitive") and kit_mode() == "strict"):
        rp = AGENT / "reviews" / f"{f['id']}.md"
        if not rp.exists() or not re.search(r"^VERDICT:\s*PASS\b", rp.read_text(errors="ignore"), re.M | re.I):
            out.append(f"independent review required: agent/reviews/{f['id']}.md must contain 'VERDICT: PASS' "
                       f"(/peer-review FEAT-x in a fresh session, ideally a DIFFERENT model)")
    return out


def check_features(d, errs, warns):
    ids = {f.get("id") for f in feats(d)}
    for f in feats(d):
        fid = f.get("id", "?")
        if f.get("status") not in STATUSES:
            errs.append(f"{fid}: invalid status {f.get('status')!r}")
        if not f.get("acceptance"):
            errs.append(f"{fid}: no acceptance criteria")
        if f.get("spec") and not (ROOT / f["spec"]).exists():
            warns.append(f"{fid}: spec {f['spec']} does not exist yet (write it from docs/specs/SPEC-TEMPLATE.md)")
        for dep in f.get("depends_on", []):
            if dep not in ids:
                errs.append(f"{fid}: depends_on unknown feature {dep}")
        for a in f.get("acceptance", []):
            k = a.get("kind", "happy")
            if k not in KINDS:
                errs.append(f"{a['id']}: unknown kind {k!r} (use {', '.join(sorted(KINDS))})")
            if k == "perf" and not re.search(r"\d", a.get("check", "")):
                errs.append(f"{a['id']}: perf criterion must contain a number (e.g. 'p95 < 300 ms at 50 req/s')")
            if a.get("passes"):
                if a.get("verified_by") not in ("test-log", "manual") or not a.get("evidence"):
                    errs.append(f"{a['id']}: passes=true without verified_by/evidence. Use: python3 scripts/kit.py pass {a['id']}")
                elif a["verified_by"] == "test-log" and not in_tests(a["id"]):
                    errs.append(f"{a['id']}: marked test-log verified but no test file contains this ID")
        if f.get("status") == "done":
            for b in done_blockers(f):
                errs.append(f"{fid}: status done but {b}")
        elif f.get("status") == "in_progress":
            kinds = {a.get("kind", "happy") for a in f.get("acceptance", [])}
            if not (kinds & ROBUST_KINDS) and not f.get("waive_robust"):
                warns.append(f"{fid}: no negative/boundary/permission/attack criterion yet (will block 'done')")
    reqs = d.get("requirements", [])
    covered = set()
    for r in reqs:
        if not r.get("features"):
            errs.append(f"{r.get('id', '?')}: requirement not mapped to any feature (silently skipped?)")
        for fid in r.get("features", []):
            covered.add(fid)
            if fid not in ids:
                errs.append(f"{r.get('id', '?')}: maps to unknown feature {fid}")
    for f in feats(d):
        if reqs and f.get("id") not in covered and f.get("origin") != "TECHNICAL REQUIREMENT":
            warns.append(f"{f.get('id')}: feature not linked from any requirement (orphan?)")


def check_immutable(d, errs):
    if os.environ.get("SPEC_CHANGE_APPROVED") == "1" or not has_head():
        return
    raw = git("show", f"{base_ref()}:agent/features.json")
    if not raw.strip():
        return
    try:
        base = json.loads(raw)
    except json.JSONDecodeError:
        return
    cur = {f["id"]: f for f in feats(d) if "id" in f}
    for bf in feats(base):
        cf = cur.get(bf["id"])
        if not cf:
            errs.append(f"{bf['id']}: feature removed (needs human approval: SPEC_CHANGE_APPROVED=1)")
            continue
        if cf.get("title") != bf.get("title"):
            errs.append(f"{bf['id']}: title changed")
        cac = {a["id"]: a for a in cf.get("acceptance", [])}
        for ba in bf.get("acceptance", []):
            if ba["id"] not in cac:
                errs.append(f"{ba['id']}: acceptance criterion removed")
            elif cac[ba["id"]].get("check") != ba.get("check"):
                errs.append(f"{ba['id']}: acceptance criterion reworded (needs human approval)")
    creq = {r["id"]: r for r in d.get("requirements", []) if "id" in r}
    for br in base.get("requirements", []):
        if br["id"] not in creq:
            errs.append(f"{br['id']}: requirement removed")
        elif creq[br["id"]].get("text") != br.get("text"):
            errs.append(f"{br['id']}: requirement text changed")


def check_diff(changed, errs, warns):
    if not changed:
        return
    if not os.environ.get("KIT_ALLOW_TEST_DELETE"):
        for st, p in changed:
            if st == "D" and is_test(p):
                errs.append(f"{p}: test file deleted")
    if any(re.search(r"(-snapshots|__screenshots__|__snapshots__)/|\.snap$", p) for st, p in changed):
        warns.append("test snapshots/baselines changed: a human must review the before/after before approving")
    allow_tc = os.environ.get("KIT_ALLOW_TEST_CHANGE") == "1"
    # weakened assertions in EXISTING tests (net removal = error; any removal = warning)
    rem, add = {}, {}
    for p, line in removed_lines(changed):
        if is_test(p) and ASSERT_RX.search(line):
            rem[p] = rem.get(p, 0) + 1
    if rem:
        for p, line in added_lines(changed):
            if p in rem and ASSERT_RX.search(line):
                add[p] = add.get(p, 0) + 1
    for p, n in rem.items():
        msg = f"{p}: {n} assertion line(s) removed/changed, {add.get(p, 0)} added"
        if n > add.get(p, 0) and not allow_tc:
            errs.append(msg + ". Tests may not be weakened; if this is a real spec change the human commits with KIT_ALLOW_TEST_CHANGE=1")
        else:
            warns.append(msg + " (check the test still proves the same thing)")
    # test-runner config that silently drops tests (only for config files that already existed)
    existed = {p for st, p in changed if st not in ("??", "A")}
    for p, line in added_lines(changed):
        if p in existed and TEST_CONFIG.search(p) and WEAKEN_RX.search(line) and not allow_tc:
            b = os.path.basename(p)
            if b == "package.json" and "test" not in line:
                continue
            if b in ("pyproject.toml", "setup.cfg", "tox.ini", "Cargo.toml") and not re.search(r"pytest|addopts|testpaths|test", line):
                continue
            errs.append(f"{p}: test configuration change may skip tests: {line.strip()[:70]} "
                        f"(human approves with KIT_ALLOW_TEST_CHANGE=1)")
    shown = 0
    for p, line in added_lines(changed):
        if p.startswith(NOT_SCANNED) or p.endswith(".md"):
            continue
        for pat in TEST_SKIP:
            if re.search(pat, line):
                errs.append(f"{p}: added test skip/disable: {line.strip()[:80]}")
        for pat in SUPPRESS:
            if re.search(pat, line):
                warns.append(f"{p}: added lint/type suppression (justify in progress.md): {line.strip()[:70]}")
        if (os.path.splitext(p)[1] in UI_EXT and shown < 5 and re.search(r"#[0-9a-fA-F]{6}\b", line)
                and not re.search(r"token|theme|global|variables|tailwind", p, re.I)):
            warns.append(f"{p}: hard-coded color; use design tokens (docs/DESIGN.md): {line.strip()[:60]}")
            shown += 1


def is_manifest(p):
    b = os.path.basename(p)
    return b in MANIFESTS or bool(re.match(r"requirements.*\.txt$", b)) or b.endswith(".csproj")


def pkg_name(s):
    m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9_.\-]*)", s)
    return m.group(1).lower() if m else None


def deps_in(path, text):
    """Set of direct dependency names declared in a manifest file's text."""
    name, names = os.path.basename(path), set()
    try:
        if name in ("package.json", "composer.json"):
            d = json.loads(text)
            for k in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "require", "require-dev"):
                names |= set((d.get(k) or {}).keys())
            names.discard("php")
        elif re.match(r"requirements.*\.txt$", name):
            for l in text.splitlines():
                if l.strip() and not l.strip().startswith(("#", "-")):
                    n = pkg_name(l)
                    if n:
                        names.add(n)
        elif name in ("pyproject.toml", "Cargo.toml"):
            try:
                import tomllib
            except ImportError:
                return names
            d = tomllib.loads(text)
            if name == "Cargo.toml":
                for k in ("dependencies", "dev-dependencies", "build-dependencies"):
                    names |= set((d.get(k) or {}).keys())
            else:
                proj = d.get("project", {})
                for item in proj.get("dependencies") or []:
                    names.add(pkg_name(item))
                for grp in (proj.get("optional-dependencies") or {}).values():
                    names |= {pkg_name(i) for i in grp}
                for grp in (d.get("dependency-groups") or {}).values():
                    names |= {pkg_name(i) for i in grp if isinstance(i, str)}
                poetry = d.get("tool", {}).get("poetry", {})
                names |= set((poetry.get("dependencies") or {}).keys())
                for g in (poetry.get("group") or {}).values():
                    names |= set((g.get("dependencies") or {}).keys())
                names.discard("python")
                names = {n.lower() for n in names if n}
        elif name == "go.mod":
            for l in text.splitlines():
                m = re.match(r"\s*(?:require\s+)?([A-Za-z0-9][\w.\-]*\.[\w.\-]+/[\w./\-~]+)\s+v[\w.\-+]+", l)
                if m:
                    names.add(m.group(1))
        elif name == "Gemfile":
            names |= set(re.findall(r"^\s*gem\s+['\"]([^'\"]+)['\"]", text, re.M))
        elif name == "pom.xml":
            names |= set(re.findall(r"<artifactId>([^<]+)</artifactId>", text))
        elif name.startswith("build.gradle"):
            names |= set(re.findall(r"(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*\(?\s*['\"]([^:'\"]+:[^:'\"]+)", text))
        elif name.endswith(".csproj"):
            names |= set(re.findall(r'PackageReference\s+Include="([^"]+)"', text))
    except Exception:
        pass
    return {n for n in names if n}


def check_deps(changed, errs):
    ms = [p for st, p in changed if is_manifest(p) and st != "D" and (ROOT / p).is_file()]
    if not ms or not has_head():
        return  # nothing changed, or the very first commit (scaffold)
    decisions = (read("docs/decisions.md") + read("docs/dependencies.md")).lower()
    for p in ms:
        new = deps_in(p, read(p, 2_000_000)) - deps_in(p, git("show", f"{base_ref()}:{p}"))
        for n in sorted(new):
            if not recorded(n, decisions):
                errs.append(f"{p}: new dependency '{n}' has no entry in docs/decisions.md or docs/dependencies.md. "
                            f"Run: python3 scripts/kit.py dep-check {n}  then record why (maintained? license? advisories? alternatives?)")


def acceptance_glob():
    return config_vals().get("ACCEPTANCE_GLOB") or "tests/acceptance/*"


def check_protected(changed, errs):
    if os.environ.get("GUARD_ADMIN") == "1" or not has_head():
        return  # no baseline commit yet: the human is installing the kit
    role_ok = os.environ.get("KIT_ROLE") in ROLES
    for st, p in changed:
        if any(fnmatch.fnmatch(p, g) for g in PROTECTED):
            errs.append(f"{p}: protected guard file changed (human must set GUARD_ADMIN=1 to allow)")
        elif kit_mode() == "strict" and not role_ok and (
                any(fnmatch.fnmatch(p, g) for g in ROLE_FILES) or fnmatch.fnmatch(p, acceptance_glob())):
            errs.append(f"{p}: only an evaluator/reviewer session may change this in strict mode "
                        f"(the human starts it with KIT_ROLE=evaluator)")


def check_cooldown(changed, errs):
    """A dependency cooldown, once committed, may not be removed by an agent."""
    if not has_head() or os.environ.get("GUARD_ADMIN") == "1":
        return
    for st, p in changed:
        key = COOLDOWN.get(p)
        if key and key in git("show", f"{base_ref()}:{p}") and key not in read(p):
            errs.append(f"{p}: dependency cooldown ({key}) removed (human must set GUARD_ADMIN=1)")


def _sig_lines(txt):
    """(line_no, normalized) for lines that carry logic: no blanks, comments, lone brackets or imports."""
    out = []
    for i, l in enumerate(txt.splitlines(), 1):
        s = " ".join(l.split())
        if (len(s) <= 3 or re.fullmatch(r"[\[\](){};,]+", s) or s.startswith(("//", "#", "*", "/*", "--", "<!--", '"""'))
                or re.match(r"(import|from|export \* from|use|package|require\(|using|include)\b", s)):
            continue
        out.append((i, s))
    return out


def _windows(txt, w):
    import hashlib
    sig = _sig_lines(txt)
    for k in range(len(sig) - w + 1):
        chunk = sig[k:k + w]
        yield hashlib.sha1("\n".join(s for _, s in chunk).encode()).hexdigest(), chunk[0][0], chunk[-1][0]


def dupe_sources():
    return [f for f in list_files() if os.path.splitext(f)[1] in SRC_EXT and not is_test(f)
            and not f.startswith(NOT_SCANNED) and not is_kit_file(f) and os.path.getsize(os.path.join(RS, f)) < 300_000]


def find_dupes(only=None):
    """[(file, line, other_file, other_line)] of repeated blocks; with only={path: added_line_numbers} report
    just blocks that touch newly added lines (so old duplication never blocks new work)."""
    w = int(config_vals().get("DUPES_MIN_LINES") or 8)
    index = {}
    for f in dupe_sources():
        for h, a, b in _windows(read(f), w):
            index.setdefault(h, []).append((f, a, b))
    out, seen = [], set()
    for h, occ in index.items():
        if len(occ) < 2:
            continue
        for f, a, b in occ:
            if only is not None and (f not in only or not only[f] & set(range(a, b + 1))):
                continue
            other = next(((g, c) for g, c, e in occ if g != f or abs(c - a) >= w), None)
            if other and frozenset((f, other[0])) not in seen:
                seen.add(frozenset((f, other[0])))
                out.append((f, a, other[0], other[1]))
    return out


def check_dupes(changed, errs, warns):
    files = {p: added_line_numbers(p, st) for st, p in changed
             if st != "D" and os.path.splitext(p)[1] in SRC_EXT and not is_test(p) and not p.startswith(NOT_SCANNED)
             and not is_kit_file(p) and (ROOT / p).is_file()}
    if not files:
        return
    for f, a, g, c in find_dupes(files)[:10]:
        msg = f"{f}:{a} duplicates {g}:{c}; reuse or extract a shared function/component (kit.py dupes for all)"
        (errs if kit_mode() == "strict" else warns).append(msg)


JS_IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)['"]([^'"]+)['"]""")


def imports_of(path, txt):
    """[(line_no, specifier, resolved_path_or_specifier)] for JS/TS, Python and Go imports."""
    ext, out, d = os.path.splitext(path)[1], [], os.path.dirname(path)
    in_go_block = False
    for i, l in enumerate(txt.splitlines(), 1):
        specs = []
        if ext in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"):
            specs = JS_IMPORT.findall(l)
        elif ext == ".py":
            m = re.match(r"\s*from\s+(\.*[\w.]*)\s+import\s+\(?([\w\s,]+)", l)
            if m:  # from app import db, models -> app, app.db, app.models
                sep = "" if m.group(1).endswith(".") else "."
                specs = [m.group(1)] + [m.group(1) + sep + n.split()[0] for n in m.group(2).split(",") if n.strip()]
            else:
                m = re.match(r"\s*import\s+([\w.]+)", l)
                specs = [m.group(1)] if m else []
        elif ext == ".go":
            s = l.strip()
            if s.startswith("import ("):
                in_go_block = True
            elif in_go_block and s == ")":
                in_go_block = False
            m = re.match(r'(?:import\s+)?(?:\w+\s+)?"([^"]+)"', s) if (in_go_block or s.startswith("import")) else None
            if m:
                specs = [m.group(1)]
        for sp in specs:
            if ext == ".py":
                dots = len(sp) - len(sp.lstrip("."))
                base = d
                for _ in range(max(dots - 1, 0)):
                    base = os.path.dirname(base)
                res = os.path.normpath(os.path.join(base, sp.lstrip(".").replace(".", "/"))) if dots else sp.replace(".", "/")
            elif sp.startswith("."):
                res = os.path.normpath(os.path.join(d, sp))
            else:
                res = sp
            out.append((i, sp, res.replace("\\", "/")))
    return out


def boundary_rules():
    rules = []
    for l in read("docs/boundaries.txt").splitlines():
        body, _, why = l.partition("#")
        m = re.match(r"\s*(\S+)\s+!->\s+(\S+)\s*$", body)
        if m:
            rules.append((m.group(1).replace("**", "*"), m.group(2).replace("**", "*"), why.strip()))
    return rules


def check_boundaries(changed, errs):
    rules = boundary_rules()
    if not rules:
        return
    for st, p in changed:
        if st == "D" or not (ROOT / p).is_file() or os.path.splitext(p)[1] not in SRC_EXT:
            continue
        mine = [r for r in rules if fnmatch.fnmatch(p, r[0])]
        if not mine:
            continue
        hit = set()
        for ln, spec, res in imports_of(p, read(p)):
            for src, tgt, why in mine:
                if (ln, tgt) not in hit and (fnmatch.fnmatch(res, tgt) or fnmatch.fnmatch(spec, tgt)):
                    hit.add((ln, tgt))
                    errs.append(f"{p}:{ln}: imports '{spec}', breaking boundary '{src} !-> {tgt}'"
                                + (f" ({why})" if why else "") + " - see docs/boundaries.txt")


def check_scope(changed, errs):
    sp = AGENT / "scope.txt"
    if not sp.exists() or os.environ.get("KIT_BASE"):
        return
    pats = []
    for l in sp.read_text().splitlines():
        l = l.split(" #")[0].strip()
        if l and not l.startswith("#"):
            pats.append(l.replace("**", "*"))
    if not pats or "*" in pats:
        return
    allowed = pats + ["agent/*", "docs/*"]
    admin = os.environ.get("GUARD_ADMIN") == "1"
    for st, p in changed:
        if os.path.basename(p) in LOCKFILES:
            continue
        if admin and (any(fnmatch.fnmatch(p, g) for g in PROTECTED + KIT_OWNED + LEGACY + UPGRADE_ADDS) or p in ("AGENTS.md", ".gitignore")
                      or p.startswith((".claude/commands/", ".opencode/", ".agent/"))):
            continue  # the human is maintaining the kit itself (config, upgrade)
        if not any(fnmatch.fnmatch(p, a) for a in allowed):
            errs.append(f"{p}: outside agent/scope.txt. If truly required, add it to scope.txt with a '# reason' and mention it in progress.md")


def check_sizes(changed, warns):
    for st, p in changed:
        if st != "D" and os.path.splitext(p)[1] in SRC_EXT and not is_test(p) and not p.startswith(NOT_SCANNED):
            n = read(p).count("\n")
            if n > 300:
                warns.append(f"{p}: {n} lines (limit 300); split by responsibility")


def check_verify(changed, errs, d=None):
    code = [p for st, p in changed if not p.startswith(("agent/", "docs/")) and not p.endswith(".md")
            and os.path.basename(p) not in LOCKFILES and st != "D" and not is_kit_file(p)
            and not p.startswith(".github/") and not (os.environ.get("GUARD_ADMIN") == "1" and p in UPGRADE_ADDS)]
    if not code or os.environ.get("KIT_SKIP_VERIFY_CHECK") == "1" or not has_head():
        return  # first commit installs the kit; nothing to verify yet
    v = verify_state()
    if not v:
        errs.append("scripts/verify.sh has not been run")
    elif v.get("RESULT") != "PASS":
        errs.append("last scripts/verify.sh run did not PASS")
    elif v["TIME"] < newest_source_mtime():
        errs.append("scripts/verify.sh is stale (source changed after it ran); run it again")
    elif d is not None:
        ratchet(d, errs)


def ratchet(d, errs):
    """The number of passing tests may not drop below the baseline recorded at the last `kit.py done`."""
    base = (d.get("meta") or {}).get("tests_passed", 0)
    n = tests_passed(read("agent/last-verify.log", 50_000_000))
    if base and n < base and os.environ.get("KIT_ALLOW_TEST_DELETE") != "1":
        errs.append(f"passing tests dropped from {base} to {n} (tests removed, skipped or no longer collected)")


def cmd_check(args):
    errs, warns = [], []
    changed = changed_files()
    d = load()
    check_features(d, errs, warns)
    check_immutable(d, errs)
    check_diff(changed, errs, warns)
    check_deps(changed, errs)
    check_protected(changed, errs)
    check_cooldown(changed, errs)
    check_scope(changed, errs)
    check_sizes(changed, warns)
    check_boundaries(changed, errs)
    check_dupes(changed, errs, warns)
    if "--commit" in args:
        check_verify(changed, errs, d)
    for w in warns:
        print("WARN  " + w)
    for e in errs:
        print("ERROR " + e)
    print(f"kit check: {len(errs)} error(s), {len(warns)} warning(s)")
    sys.exit(1 if errs else 0)


# ---------- feature commands ----------
def cmd_status(_):
    d = load()
    print(f"{'ID':<10}{'STATUS':<13}{'AC':<7}TITLE")
    counts = {}
    for f in feats(d):
        acs = f.get("acceptance", [])
        ok = sum(1 for a in acs if a.get("passes"))
        st = f.get("status", "?")
        counts[st] = counts.get(st, 0) + 1
        print(f"{f.get('id', '?'):<10}{st:<13}{ok}/{len(acs):<5}{f.get('title', '')}")
        if st in ("in_progress", "blocked"):
            for a in acs:
                if not a.get("passes"):
                    print(f"            - missing {a['id']}: {a.get('check', '')[:90]}")
    print("TOTAL " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))


def cmd_start(args):
    d = load()
    f = next((x for x in feats(d) if x["id"] == args[0]), None) if args else None
    if not f:
        die("usage: kit.py start FEAT-001")
    done = {x["id"] for x in feats(d) if x["status"] == "done"}
    missing = [x for x in f.get("depends_on", []) if x not in done]
    if missing:
        die(f"{f['id']} depends on unfinished: {', '.join(missing)}")
    f["status"] = "in_progress"
    save(d)
    print(f"{f['id']} -> in_progress")


def cmd_pass(args):
    if not args:
        die('usage: kit.py pass AC-001-01 [--evidence "..."] [--manual]')
    aid, manual = args[0], "--manual" in args
    ev = args[args.index("--evidence") + 1] if "--evidence" in args and len(args) > args.index("--evidence") + 1 else ""
    d = load()
    f, a = find_ac(d, aid)
    if not a:
        die(f"unknown acceptance criterion {aid}")
    if manual:
        if len(ev) < 10:
            die("--manual requires --evidence describing exactly what you did and saw (>=10 chars)")
        role = os.environ.get("KIT_ROLE")
        if kit_mode() == "strict" and role not in ROLES:
            die("strict mode: manual criteria are verified by an evaluator, not the builder. The human starts a fresh "
                "session with KIT_ROLE=evaluator and runs /evaluate " + f["id"])
        a["verified_by"], a["evidence"] = ("evaluator" if role in ROLES else "manual"), ev
    else:
        v = verify_state()
        if not v or v.get("RESULT") != "PASS":
            die("last scripts/verify.sh run missing or not PASS")
        if v["TIME"] < newest_source_mtime():
            die("verify is stale: source changed after scripts/verify.sh ran. Re-run it.")
        if not ac_re(aid).search(read("agent/last-verify.log", 50_000_000)):
            die(f"{aid} not found in the verify test log. Name a test with this ID and make the test reporter print "
                f"test names (verbose), or use --manual with real evidence (browser/screenshot steps).")
        if not in_tests(aid):
            die(f"no test file mentions {aid}")
        rerr = []
        ratchet(d, rerr)
        if rerr:
            die(rerr[0])
        a["verified_by"], a["evidence"] = "test-log", ev or f"verify.sh PASS {time.strftime('%Y-%m-%d %H:%M', time.localtime(v['TIME']))}; log contains {aid}"
    a["passes"] = True
    save(d)
    rem = [x["id"] for x in f["acceptance"] if not x.get("passes")]
    print(f"{aid} passes ({a['verified_by']}). Remaining in {f['id']}: {', '.join(rem) or 'none'}")


def cmd_fail(args):
    d = load()
    f, a = find_ac(d, args[0]) if args else (None, None)
    if not a:
        die("usage: kit.py fail AC-001-01")
    a["passes"], a["verified_by"], a["evidence"] = False, "", ""
    if f["status"] == "done":
        f["status"] = "in_progress"
    save(d)
    print(f"{args[0]} reset to failing; {f['id']} is {f['status']}")


def cmd_done(args):
    d = load()
    f = next((x for x in feats(d) if x["id"] == args[0]), None) if args else None
    if not f:
        die("usage: kit.py done FEAT-001")
    blockers = done_blockers(f)
    if blockers:
        die(f"{f['id']} cannot be marked done:\n  - " + "\n  - ".join(blockers))
    f["files"] = feature_files(f)          # remembered for every later session: kit.py where FEAT-x
    f["status"] = "done"
    n = tests_passed(read("agent/last-verify.log", 50_000_000))
    meta = d.setdefault("meta", {})
    if verify_state() and verify_state().get("RESULT") == "PASS" and n >= meta.get("tests_passed", 0):
        meta["tests_passed"] = n           # ratchet: later sessions may not drop below this
    save(d)
    print(f"{f['id']} -> done ({len(f['files'])} file(s) recorded; passing-test baseline {meta.get('tests_passed', 0)})")
    print(f"Next: progress entry in agent/progress.md, then git add -A && git commit -m \"{f['id']}: <what>\"")


def cmd_block(args):
    d = load()
    f = next((x for x in feats(d) if x["id"] == args[0]), None) if args else None
    if not f or len(args) < 2:
        die('usage: kit.py block FEAT-001 "reason"')
    f["status"], f["notes"] = "blocked", " ".join(args[1:])
    save(d)
    print(f"{f['id']} -> blocked")


# ---------- dependency vetting ----------
def _get_json(url):
    import urllib.request, urllib.error
    req = urllib.request.Request(url, headers={"User-Agent": "ai-build-kit-dep-check", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def _dt(s):
    import datetime
    try:
        d = datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=datetime.timezone.utc)
    except Exception:
        return None


def _guess_eco():
    for f, e in (("package.json", "npm"), ("pyproject.toml", "pypi"), ("requirements.txt", "pypi"),
                 ("Cargo.toml", "crates"), ("go.mod", "go")):
        if (ROOT / f).exists():
            return e
    return "npm"


def cmd_dep_check(args):
    import urllib.error, urllib.parse, datetime
    if not args:
        die("usage: kit.py dep-check <package> [--eco npm|pypi|crates|go]")
    name = args[0]
    eco = args[args.index("--eco") + 1] if "--eco" in args and len(args) > args.index("--eco") + 1 else (
        "go" if name.startswith(("github.com/", "golang.org/", "go.uber.org/")) else _guess_eco())
    info = {}
    try:
        if eco == "npm":
            d = _get_json("https://registry.npmjs.org/" + urllib.parse.quote(name, safe="@"))
            latest = (d.get("dist-tags") or {}).get("latest", "?")
            t = d.get("time") or {}
            repo = d.get("repository")
            info = {"latest": latest, "created": t.get("created"), "last_release": t.get(latest) or t.get("modified"),
                    "license": d.get("license"), "repo": repo.get("url") if isinstance(repo, dict) else repo,
                    "maintainers": len(d.get("maintainers") or [])}
            try:
                dl = _get_json("https://api.npmjs.org/downloads/point/last-week/" + urllib.parse.quote(name, safe="@"))
                info["weekly_downloads"] = dl.get("downloads")
            except Exception:
                pass
        elif eco == "pypi":
            d = _get_json("https://pypi.org/pypi/" + urllib.parse.quote(name) + "/json")
            up = [(_dt(f.get("upload_time_iso_8601")), v) for v, fs in (d.get("releases") or {}).items() for f in fs]
            up = [x for x in up if x[0]]
            urls = d.get("info", {}).get("project_urls") or {}
            info = {"latest": d["info"].get("version"), "created": min(up)[0].isoformat() if up else None,
                    "last_release": max(up)[0].isoformat() if up else None, "license": d["info"].get("license") or "see classifiers",
                    "repo": next((v for k, v in urls.items() if re.search(r"source|repo|github|code", k, re.I)), d["info"].get("home_page")),
                    "maintainers": None}
        elif eco == "crates":
            d = _get_json("https://crates.io/api/v1/crates/" + urllib.parse.quote(name))
            c = d.get("crate", {})
            info = {"latest": c.get("max_version"), "created": c.get("created_at"), "last_release": c.get("updated_at"),
                    "license": (d.get("versions") or [{}])[0].get("license"), "repo": c.get("repository"),
                    "weekly_downloads": c.get("recent_downloads"), "maintainers": None}
        elif eco == "go":
            esc = re.sub(r"[A-Z]", lambda m: "!" + m.group(0).lower(), name)
            d = _get_json("https://proxy.golang.org/" + esc + "/@latest")
            info = {"latest": d.get("Version"), "created": None, "last_release": d.get("Time"), "license": "check pkg.go.dev",
                    "repo": name, "maintainers": None}
        else:
            die("unknown --eco (use npm, pypi, crates, go)")
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            print(f"{name} ({eco})\nRESULT: NOT FOUND in the public registry. It is probably a hallucinated name. DO NOT INSTALL.")
            sys.exit(1)
        print(f"{name} ({eco})\nRESULT: UNREACHABLE (HTTP {e.code}). Verify manually before installing.")
        sys.exit(2)
    except Exception as e:
        print(f"{name} ({eco})\nRESULT: UNREACHABLE ({e}). Verify manually (registry website) before installing.")
        sys.exit(2)
    now = datetime.datetime.now(datetime.timezone.utc)
    warns = []
    cr, lr = _dt(info.get("created")), _dt(info.get("last_release"))
    if cr and (now - cr).days < 90:
        warns.append(f"package is only {(now - cr).days} days old")
    if lr and (now - lr).days < 3:
        warns.append(f"latest release is {(now - lr).days} day(s) old: brand-new versions are where hijacked releases "
                     f"hide; the cooldown (kit.py harden) installs an older one")
    if lr and (now - lr).days > 730:
        warns.append(f"last release was {(now - lr).days // 365} years ago (possibly unmaintained)")
    if not info.get("repo"):
        warns.append("no repository link")
    if info.get("weekly_downloads") is not None and info["weekly_downloads"] < 1000:
        warns.append(f"low usage ({info['weekly_downloads']} downloads/week); typosquat or niche?")
    print(f"{name} ({eco})")
    for k in ("latest", "created", "last_release", "license", "repo", "weekly_downloads", "maintainers"):
        if info.get(k) is not None:
            print(f"  {k:<17}{info[k]}")
    for w in warns:
        print("  WARN  " + w)
    print("RESULT: EXISTS" + (" (review the warnings; record your decision in docs/decisions.md)" if warns else
                               " (still record why you chose it in docs/decisions.md)"))


# ---------- independent review pack ----------
def cmd_review_pack(args):
    if not in_git():
        die("review-pack needs a git repository")
    base, sel, i = None, [], 0
    while i < len(args):
        if args[i] == "--feat" and i + 1 < len(args):
            sel.append(args[i + 1]); i += 2
        elif args[i] == "--base" and i + 1 < len(args):
            base = args[i + 1]; i += 2
        else:
            base = args[i]; i += 1
    head = git("rev-parse", "HEAD").strip()
    if not base:
        for cand in ("origin/main", "origin/master", "main", "master"):
            mb = git("merge-base", "HEAD", cand).strip()
            if mb and mb != head:
                base = mb
                break
        base = base or "HEAD~1"
    ex = [":(exclude)agent", ":(exclude)*.lock", ":(exclude)package-lock.json", ":(exclude)pnpm-lock.yaml",
          ":(exclude)go.sum", ":(exclude)*.png", ":(exclude)*.jpg", ":(exclude)*.svg", ":(exclude)*.map"]
    stat = git("diff", base, "--stat", "--no-color", "--", ".", *ex).strip()
    diff = git("diff", base, "--no-color", "-U6", "--", ".", *ex)
    untracked = [p for st, p in changed_files() if st == "??" and not p.startswith("agent/") and (ROOT / p).is_file()]
    for p in untracked[:30]:
        diff += f"\n--- new untracked file: {p} ---\n" + read(p, 20_000)
    ids = set(re.findall(r"\bFEAT-\d+\b", diff)) | set(sel)
    note = ""
    if len(diff) > 120_000:
        note = f"\n[diff truncated at 120k of {len(diff)} chars; review the remaining files directly with git diff {base}]\n"
        diff = diff[:120_000]
    out = ["# Review pack (author identity and commit messages intentionally omitted)",
           "", "You are an independent reviewer. Do not guess who wrote this. Do not read agent/progress.md.",
           f"Base: {base[:12]}  |  Head: {head[:12]}", ""]
    v = verify_state()
    out.append("Last verify: " + (f"{v.get('RESULT')} (skipped steps: {v.get('SKIPPED', '?')})" if v else "never run"))
    dup = find_dupes({p: added_line_numbers(p, st) for st, p in changed_files() if st != "D" and (ROOT / p).is_file()
                      and os.path.splitext(p)[1] in SRC_EXT and not is_test(p)}) if changed_files() else []
    if dup:
        out.append("Duplicated blocks in this change: " + "; ".join(f"{f}:{a} == {g}:{c}" for f, a, g, c in dup[:5]))
    out += ["", "## Acceptance criteria under review"]
    d = json.loads(FEATURES.read_text()) if FEATURES.exists() else {"features": []}
    shown = [f for f in feats(d) if f["id"] in ids] or [f for f in feats(d) if f["status"] == "in_progress"]
    for f in shown:
        flags = ", ".join(k for k in ("security_sensitive", "review_required") if f.get(k))
        out.append(f"### {f['id']} {f['title']}" + (f"  [{flags}]" if flags else ""))
        out += [f"- {a['id']} [{a.get('kind', 'happy')}] {a['check']}" for a in f.get("acceptance", [])]
    if not shown:
        out.append("(no feature tags found in the diff; pass --feat FEAT-001)")
    out += ["", "## Changed files", "```", stat or "(none)", "```", "", "## Diff", "```diff", diff, "```", note]
    (AGENT / "reviews").mkdir(parents=True, exist_ok=True)
    (AGENT / "review-pack.md").write_text("\n".join(out))
    print(f"wrote agent/review-pack.md ({len(diff)} diff chars; features: {', '.join(f['id'] for f in shown) or 'none'})")
    print("Next: open a FRESH session (ideally a DIFFERENT model) and run /peer-review. "
          "It must write agent/reviews/<FEAT-ID>.md ending with VERDICT: PASS or VERDICT: FAIL.")


# ---------- symbols (for `where`) ----------
PAT = {
    ".py": [r"^(?:async\s+)?def\s+(\w+)", r"^class\s+(\w+)"],
    ".go": [r"^func\s+(?:\([^)]*\)\s*)?(\w+)", r"^type\s+(\w+)"],
    ".rs": [r"^\s*pub(?:\([a-z]+\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const)\s+(\w+)", r"^(?:async\s+)?fn\s+(\w+)"],
    ".rb": [r"^\s*(?:class|module)\s+(\w+)", r"^\s*def\s+(?:self\.)?(\w+)"],
    ".php": [r"^\s*(?:abstract\s+)?(?:class|interface|trait)\s+(\w+)", r"^\s*(?:public\s+|static\s+)*function\s+(\w+)"],
    ".java": [r"^\s*(?:public|protected|internal)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|enum|record)\s+(\w+)"],
    ".kt": [r"^\s*(?:class|interface|object|enum class|data class)\s+(\w+)", r"^\s*(?:suspend\s+)?fun\s+(\w+)"],
    ".cs": [r"^\s*(?:public|internal)?\s*(?:static\s+)?(?:sealed\s+)?(?:abstract\s+)?(?:partial\s+)?(?:class|interface|enum|record|struct)\s+(\w+)"],
}
JS = [r"^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+(\w+)",
      r"^(?:async\s+)?function\s+(\w+)", r"^class\s+(\w+)"]
for _e in (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"):
    PAT[_e] = JS


@lru_cache(maxsize=None)
def _rx(ext):
    pats = PAT.get(ext)
    # [ \t] instead of \s: in multiline mode \s would let a match run across lines (wrong line numbers)
    return re.compile("|".join(f"(?:{p})".replace(r"\s", r"[ \t]") for p in pats), re.M) if pats else None


def _scan(txt, ext):
    syms, seen, rx = [], set(), _rx(ext)
    if rx:
        line, pos = 1, 0
        for m in rx.finditer(txt):
            name = next(g for g in m.groups() if g)
            line += txt.count("\n", pos, m.start())
            pos = m.start()
            if name not in seen:
                seen.add(name)
                syms.append([name, line])
    return {"n": txt.count("\n") + 1, "syms": syms}


@lru_cache(maxsize=None)
def scan_all():
    """{path: {n, syms}}. Incremental: only files whose mtime/size changed are re-read (agent/.symbols-cache.json)."""
    files = sorted(f for f in list_files() if os.path.splitext(f)[1] in SRC_EXT
                   and not f.startswith(("agent/", "docs/")) and not is_kit_file(f))
    try:
        cache = json.loads(SYMBOL_CACHE.read_text())
    except Exception:
        cache = {}
    out, dirty = {}, False
    for f in files:
        try:
            st = os.stat(os.path.join(RS, f))
        except OSError:
            continue
        key = [st.st_mtime, st.st_size]
        c = cache.get(f)
        if c and c.get("key") == key:
            out[f] = c
            continue
        e = _scan(read(f), os.path.splitext(f)[1])
        e["key"] = key
        out[f], dirty = e, True
    if dirty or len(out) != len(cache):
        AGENT.mkdir(exist_ok=True)
        SYMBOL_CACHE.write_text(json.dumps(out, separators=(",", ":")))
    return out


# ---------- feature <-> files ----------
def _product_file(p):
    return not (p.startswith(("agent/", "docs/")) or p.endswith(".md") or is_kit_file(p)
                or os.path.basename(p) in LOCKFILES)


def feature_files(f):
    """Files of a feature: recorded at `done` + every commit whose message starts with the feature id
    (`FEAT-003: ...`, `FEAT-003 fix: ...`) + uncommitted changes while it is in progress."""
    files = set(f.get("files") or [])
    if in_git() and has_head():
        out = git("log", "--format=", "--name-only", "-E", f"--grep=^{re.escape(f['id'])}\\b")
        files |= {p for p in out.splitlines() if p and _product_file(p)}
    if f.get("status") == "in_progress":
        files |= {p for st, p in changed_files() if st != "D" and _product_file(p)}
    return sorted(p for p in files if (ROOT / p).exists())


def cmd_where(args):
    if not args:
        die("usage: kit.py where <FEAT-001 | AC-001-01 | symbol or path fragment>")
    term, out, cap = args[0], [], 40
    if re.fullmatch(r"FEAT-\d+", term, re.I):
        d = load()
        f = next((x for x in feats(d) if x["id"] == term.upper()), None)
        if not f:
            die(f"unknown feature {term}")
        entries = scan_all()
        for p in feature_files(f):
            e = entries.get(p)
            s = ", ".join(f"{n}:{ln}" for n, ln in e["syms"][:6]) if e else ""
            out.append(f"{p}" + (f" ({e['n']}): {s}" if e else ""))
        hdr = f"{f['id']}: {len(out)} file(s) (recorded at done + commits '{f['id']}: ...')"
    elif re.fullmatch(r"AC-\d+-\d+", term, re.I):
        rx = ac_re(term)
        for f in list_files():
            if is_test(f):
                for i, l in enumerate(read(f).splitlines(), 1):
                    if rx.search(l):
                        out.append(f"{f}:{i}: {l.strip()[:120]}")
        hdr = f"{term.upper()}: {len(out)} test line(s)"
    else:
        t = term.lower()
        for f, e in scan_all().items():
            hits = [f"{n}:{ln}" for n, ln in e["syms"] if t in n.lower()]
            if hits:
                out.append(f"{f}: {', '.join(hits[:8])}")
            elif t in f.lower():
                out.append(f"{f} ({e['n']} lines)")
        hdr = f"'{term}': {len(out)} file(s) (symbol or path match; for usages run: rg -n \"{term}\")"
    print(hdr)
    print("\n".join(out[:cap]) + (f"\n... {len(out) - cap} more; narrow the term" if len(out) > cap else ""))


def cmd_show(args):
    d = load()
    fs = feats(d)
    sel = [f for f in fs if f.get("id") in args] if args else [f for f in fs if f.get("status") == "in_progress"]
    if not sel:
        die("usage: kit.py show FEAT-001  (no argument = in-progress features)" if args else "no in-progress feature; pass an id")
    for f in sel:
        flags = [k for k in ("security_sensitive", "review_required", "waive_robust") if f.get(k)]
        print(f"{f['id']} {f.get('title', '')} [{f.get('status')}]" + (f" {{{', '.join(flags)}}}" if flags else ""))
        for k in ("depends_on", "spec", "notes"):
            if f.get(k):
                print(f"  {k}: {f[k]}")
        for a in f.get("acceptance", []):
            print(f"  {'x' if a.get('passes') else ' '} {a['id']} [{a.get('kind', 'happy')}] {a.get('check', '')}")
        ff = feature_files(f)
        if ff:
            print(f"  files: {', '.join(ff[:15])}" + (f" +{len(ff) - 15}" if len(ff) > 15 else ""))


def cmd_dupes(_):
    found = find_dupes()
    w = int(config_vals().get("DUPES_MIN_LINES") or 8)
    print(f"{len(found)} repeated block(s) of {w}+ logic lines (tests excluded):")
    for f, a, g, c in found[:30]:
        print(f"  {f}:{a}  ==  {g}:{c}")
    if len(found) > 30:
        print(f"  ... {len(found) - 30} more")


# ---------- brief ----------
def cmd_brief(_):
    out = [f"== SESSION BRIEF == (kit {KIT_VERSION}, mode {kit_mode()})"]
    if "{{PROJECT_NAME}}" in read("AGENTS.md"):
        out.append("SETUP: kit not initialised. Human runs: python3 scripts/kit.py init")
    if (AGENT / "plan.json").exists():
        out.append("PENDING PLAN: agent/plan.json awaits human approval, then: python3 scripts/kit.py import")
    changed = []
    if in_git():
        changed = changed_files()
        out.append(f"Branch: {git('rev-parse', '--abbrev-ref', 'HEAD').strip() or '(none)'} | uncommitted files: {len(changed)}")
        code = [p for st, p in changed if st != "D" and _product_file(p) and not p.startswith(".github/")]
        if code:
            out.append("  uncommitted code (unfinished work?): " + ", ".join(code[:8]) + (f" +{len(code) - 8}" if len(code) > 8 else ""))
        log = git("log", "--oneline", "-3").strip()
        if log:
            out.append("Recent commits: " + " | ".join(l[:70] for l in log.splitlines()))
    v = verify_state()
    d = None
    if FEATURES.exists():
        try:
            d = json.loads(FEATURES.read_text())
        except Exception as e:
            out.append(f"features.json unreadable: {e}")
    if not v:
        out.append("Verify: never run (bash scripts/verify.sh)")
    else:
        stale = " (STALE: source changed since)" if v["TIME"] < newest_source_mtime() else ""
        base = ((d or {}).get("meta") or {}).get("tests_passed", 0)
        n = tests_passed(read("agent/last-verify.log", 50_000_000))
        out.append(f"Verify: {v.get('RESULT', '?')} {ago(v['TIME'])}{stale} | passing tests: {n}" + (f" (baseline {base})" if base else ""))
    dev = read("scripts/dev.sh")
    if dev and "KICKOFF_FILLS_THIS" not in dev:
        out.append("Start the app: bash scripts/dev.sh")
    if d is not None:
        fs = feats(d)
        c = {}
        for f in fs:
            c[f.get("status", "?")] = c.get(f.get("status", "?"), 0) + 1
        out.append("Features: " + (", ".join(f"{k}={v}" for k, v in sorted(c.items()))
                                   or "none yet. NEXT: kickoff (/kickoff or KICKOFF-PROMPT.md); build nothing before the plan is imported"))
        for f in fs:
            if f.get("status") == "in_progress":
                flags = ", ".join(k for k in ("security_sensitive", "review_required") if f.get(k))
                out.append(f"IN PROGRESS: {f['id']} {f.get('title', '')}" + (f" [{flags}]" if flags else ""))
                miss = [a for a in f.get("acceptance", []) if not a.get("passes")]
                out += [f"  - {a['id']} [{a.get('kind', 'happy')}] {a.get('check', '')[:110]}" for a in miss[:8]]
                if not miss:
                    out.append("  all criteria pass: run kit.py done " + f["id"])
                ff = feature_files(f)
                if ff:
                    out.append("  files so far: " + ", ".join(ff[:10]))
        pend = [f["id"] for f in fs if f.get("security_sensitive") and f.get("status") == "done"
                and not (AGENT / "reviews" / f"{f['id']}.md").exists() and not (AGENT / "evaluations" / f"{f['id']}.md").exists()]
        if pend:
            out.append(f"SECURITY: done but never reviewed/evaluated: {', '.join(pend)} (run /security or /peer-review)")
        done = {f["id"] for f in fs if f.get("status") == "done"}
        nxt = sorted((f for f in fs if f.get("status") == "todo" and all(x in done for x in f.get("depends_on", []))),
                     key=lambda f: f.get("priority", 99))
        if nxt:
            out.append(f"NEXT: {nxt[0]['id']} {nxt[0].get('title', '')}")
    sc = AGENT / "scope.txt"
    if sc.exists():
        out.append("Scope: " + ", ".join(l.strip() for l in sc.read_text().splitlines() if l.strip() and not l.startswith("#"))[:200])
    dr = AGENT / "directives.md"
    if dr.exists():
        body = [l for l in dr.read_text().splitlines() if l.strip() and not l.startswith("#")][:40]
        if body:
            out.append("USER DIRECTIVES (always obey):\n  " + "\n  ".join(body))
    pr = AGENT / "progress.md"
    if pr.exists():
        blk, seen = [], 0
        for l in pr.read_text().splitlines():
            if l.startswith("## "):
                seen += 1
                if seen > 1:
                    break
            if seen == 1 and l.strip() and not re.fullmatch(r"[^:]{1,60}:\s*", l):
                blk.append(l)
        if blk and "YYYY" not in blk[0]:
            out.append("Last progress:\n  " + "\n  ".join(blk[:12]))
    ki = AGENT / "known-issues.md"
    if ki.exists():
        rows = [l for l in ki.read_text().splitlines() if l.startswith("|") and re.search(r"\bopen\b", l, re.I)]
        if rows:
            hi = sum(1 for l in rows if re.search(r"\|\s*(HIGH|H)\s*\|", l, re.I))
            out.append(f"Open known issues: {len(rows)}" + (f" ({hi} HIGH: fix before new features)" if hi else ""))
    out.append("Find code: kit.py where <FEAT-id|AC-id|symbol>; criteria: kit.py show. Never read features.json whole.")
    print("\n".join(out))


# ---------- stop check (Claude Code Stop hook; also usable by any agent) ----------
def cmd_stop_check(args):
    """Blocks an agent from ending its turn with a half-finished feature. Fires only on specific states, so normal
    chat costs nothing: a feature marked done but not written up or committed, or all criteria passing but not done."""
    try:
        data = json.loads(sys.stdin.read() or "{}") if not sys.stdin.isatty() else {}
    except Exception:
        data = {}
    if data.get("stop_hook_active") or not FEATURES.exists() or not in_git():
        sys.exit(0)  # already reminded once this turn: never loop
    d = load()
    changed = {p for st, p in changed_files()}
    reasons = []
    if "agent/features.json" in changed and has_head():
        try:
            old = {f["id"]: f.get("status") for f in feats(json.loads(git("show", "HEAD:agent/features.json") or "{}"))}
        except json.JSONDecodeError:
            old = {}
        new_done = [f["id"] for f in feats(d) if f.get("status") == "done" and old.get(f["id"]) != "done"]
        if new_done and "agent/progress.md" not in changed:
            reasons.append(f"{', '.join(new_done)} is done: add the agent/progress.md entry (<=8 lines) at the top")
        elif new_done:
            reasons.append(f"{', '.join(new_done)} is done: commit it: git add -A && git commit -m \"{new_done[0]}: <what>\"")
    for f in feats(d):
        if f.get("status") == "in_progress" and f.get("acceptance") and all(a.get("passes") for a in f["acceptance"]):
            reasons.append(f"all criteria of {f['id']} pass: run python3 scripts/kit.py done {f['id']}")
    if reasons:
        print("Before you stop: " + "; ".join(reasons) + ". Then end with the REPORT.", file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


# ---------- dependency cooldown (supply-chain protection) ----------
def cmd_harden(args):
    """Writes a 'minimum release age' for the project's package managers: freshly published (possibly malicious)
    versions are not installed until they are a few days old. Idempotent; safe to re-run after adding a manifest."""
    days = int(_opt(args, "--days", "3"))
    stack = config_vals().get("KIT_STACK", "auto")
    did = []
    def ensure(path, key, line, header=""):
        p = ROOT / path
        t = p.read_text() if p.exists() else ""
        if key in t:
            return
        p.write_text((t.rstrip() + "\n" if t.strip() else header) + line + "\n")
        did.append(f"{path}: {line.strip()}")
    node = (ROOT / "package.json").exists() or stack in ("node", "pnpm", "pnpm-monorepo")
    pnpm = (ROOT / "pnpm-lock.yaml").exists() or stack in ("pnpm", "pnpm-monorepo")
    bun = (ROOT / "bun.lock").exists() or (ROOT / "bun.lockb").exists()
    py = any((ROOT / x).exists() for x in ("pyproject.toml", "requirements.txt", "uv.lock")) or stack == "python"
    if pnpm:
        ensure("pnpm-workspace.yaml", "minimumReleaseAge", f"minimumReleaseAge: {days * 1440}   # minutes; kit.py harden")
    elif bun:
        ensure("bunfig.toml", "minimumReleaseAge", f"minimumReleaseAge = {days * 86400}   # seconds; kit.py harden", "[install]\n")
    elif node:
        ensure(".npmrc", "min-release-age", f"min-release-age={days}", "# npm >= 11.10; kit.py harden\n")
    if py:
        ensure("uv.toml", "exclude-newer", f'exclude-newer = "{days} days"', "# uv: ignore releases younger than this; kit.py harden\n")
    if not (node or py):
        print("No Node or Python project detected (yet). Re-run after FEAT-001 creates the manifest. "
              "Go/Rust: no native cooldown; rely on lockfiles + osv-scanner/cargo audit.")
    print("\n".join(did) or "cooldown already configured")
    if did and has_head():
        print("These are protected files: commit them yourself with GUARD_ADMIN=1.")


# ---------- hooks for every agent ----------
HOOK_FILES = {"Claude Code": ".claude/settings.json", "Cursor": ".cursor/hooks.json", "Gemini CLI": ".gemini/settings.json",
              "Copilot CLI": ".github/hooks/kit-guard.json"}
CODEX_SNIPPET = """Codex CLI only reads hooks from your HOME, so the kit cannot ship them. Once per machine:
  1. ~/.codex/config.toml:   [features]\\n   codex_hooks = true
  2. ~/.codex/hooks.json:
{"hooks": {"PreToolUse": [{"matcher": ".*", "hooks": [{"type": "command",
   "command": "test -f .claude/hooks/protect.py && python3 .claude/hooks/protect.py --agent codex || true"}]}]}}
  3. start codex in the project and approve the hook once (/hooks)."""


def cmd_hooks(_):
    for name, f in HOOK_FILES.items():
        ok = "protect.py" in read(f)
        print(f"{'OK  ' if ok else 'MISS'}  {name:<12} {f}")
    home = Path.home() / ".codex" / "hooks.json"
    print(f"{'OK  ' if home.exists() and 'protect.py' in home.read_text(errors='ignore') else 'MISS'}  {'Codex CLI':<12} ~/.codex/hooks.json")
    print("\n" + CODEX_SNIPPET)


# ---------- skills (one source for every agent) ----------
KIT_SKILLS = ["kickoff", "feature", "bugfix", "change", "prove", "state", "security", "peer-review", "audit", "perf", "evaluate"]


def claude_skill(text):
    """The open SKILL.md standard needs only name + description; Claude Code also understands argument-hint and
    disable-model-invocation (user-invoked only: the agent never starts /kickoff or /change on its own)."""
    if not text.startswith("---"):
        return text
    end = text.index("\n---", 3)
    front, body = text[:end], text[end:]
    m = re.search(r"^\s+argument-hint:\s*(.+)$", front, re.M)
    extra = (f"\nargument-hint: {m.group(1).strip()}" if m else "") + "\ndisable-model-invocation: true"
    return front + extra + body


def skills_out_of_sync():
    bad = []
    src = ROOT / ".agents/skills"
    for d in sorted(src.iterdir()) if src.exists() else []:
        a, b = d / "SKILL.md", ROOT / ".claude/skills" / d.name / "SKILL.md"
        if a.exists() and (not b.exists() or claude_skill(a.read_text()) != b.read_text()):
            bad.append(d.name)
    return bad


def cmd_sync_skills(_):
    """.agents/skills is the source (read by Codex, Cursor, Gemini, Antigravity, Copilot, OpenCode...);
    Claude Code reads .claude/skills, so the kit keeps a copy there."""
    src = ROOT / ".agents/skills"
    n = 0
    for d in sorted(src.iterdir()) if src.exists() else []:
        if (d / "SKILL.md").exists():
            dst = ROOT / ".claude/skills" / d.name
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(d, dst)
            (dst / "SKILL.md").write_text(claude_skill((d / "SKILL.md").read_text()))
            n += 1
    print(f"synced {n} skill(s): .agents/skills -> .claude/skills")


# ---------- setup: init, config, doctor ----------
PRESETS = {
    "auto": ("let verify.sh auto-detect Node, Python, Go or Rust from the manifest files", {}),
    "node": ("single Node/TypeScript package, npm (scripts: typecheck, lint, test; test prints test names)", {
        "VERIFY_TYPECHECK": "npm run --if-present typecheck",
        "VERIFY_LINT": "npm run --if-present lint",
        "VERIFY_TEST": "npm test",
        "VERIFY_BUILD": "npm run --if-present build",
        "VERIFY_E2E": "npm run --if-present test:e2e",
        "VERIFY_AUDIT": "npm audit --audit-level=high --omit=dev"}),
    "pnpm": ("single Node/TypeScript package, pnpm", {
        "VERIFY_TYPECHECK": "pnpm run --if-present typecheck",
        "VERIFY_LINT": "pnpm run --if-present lint",
        "VERIFY_TEST": "pnpm test",
        "VERIFY_BUILD": "pnpm run --if-present build",
        "VERIFY_E2E": "pnpm run --if-present test:e2e",
        "VERIFY_AUDIT": "pnpm audit --audit-level=high --prod"}),
    "pnpm-monorepo": ("pnpm workspace (apps/*, packages/*), Vitest + Biome", {
        "VERIFY_TYPECHECK": "pnpm -r --if-present typecheck",
        "VERIFY_LINT": "pnpm biome ci .",
        "VERIFY_TEST": "pnpm -r --if-present test -- --reporter=verbose",
        "VERIFY_TEST_QUICK": "pnpm -r --if-present test -- --reporter=verbose --changed --passWithNoTests",
        "VERIFY_BUILD": "pnpm -r --if-present build",
        "VERIFY_E2E": "pnpm -r --if-present test:e2e",
        "VERIFY_AUDIT": "pnpm audit --audit-level=high --prod"}),
    "python": ("Python with ruff, mypy and pytest", {
        "VERIFY_TYPECHECK": "mypy . --exclude '^(scripts/kit\\.py|\\.claude/)'",
        "VERIFY_LINT": "ruff check . --extend-exclude scripts/kit.py,.claude",
        "VERIFY_TEST": "pytest -v",
        "VERIFY_TEST_QUICK": "pytest -v -x --ff",
        "VERIFY_AUDIT": "pip-audit"}),
    "go": ("Go modules", {
        "VERIFY_TYPECHECK": "go vet ./...",
        "VERIFY_LINT": "golangci-lint run",
        "VERIFY_TEST": "go test -v ./...",
        "VERIFY_BUILD": "go build ./...",
        "VERIFY_AUDIT": "govulncheck ./..."}),
    "rust": ("Rust / Cargo", {
        "VERIFY_TYPECHECK": "cargo check --all-targets",
        "VERIFY_LINT": "cargo clippy --all-targets -- -D warnings",
        "VERIFY_TEST": "cargo test",
        "VERIFY_BUILD": "cargo build",
        "VERIFY_AUDIT": "cargo audit"}),
}
MODES = {"fast": "build e2e audit scanners perf mutation", "strict": "mutation"}
CFG_KEYS = ["VERIFY_TYPECHECK", "VERIFY_LINT", "VERIFY_TEST", "VERIFY_TEST_QUICK", "VERIFY_BUILD", "VERIFY_E2E", "VERIFY_AUDIT",
            "VERIFY_PERF", "VERIFY_MUTATION"]
EXTRA_KEYS = {"ACCEPTANCE_GLOB": "tests/acceptance/*", "DUPES_MIN_LINES": "8"}


def write_config(stack, mode):
    if stack not in PRESETS:
        die(f"unknown stack '{stack}'. Choose: {', '.join(PRESETS)}")
    if mode not in MODES:
        die("mode must be fast or strict")
    desc, cfg = PRESETS[stack]
    old = config_vals()
    keep = {k: v for k, v in old.items() if k not in CFG_KEYS + list(EXTRA_KEYS) + ["KIT_STACK", "KIT_MODE", "VERIFY_CI_ONLY", "VERIFY_TAIL"]}
    out = ["# Verify commands (sourced by scripts/verify.sh). Written by `kit.py config`; edit by hand if needed.",
           "# PROTECTED: agents may not change this file; commit changes with GUARD_ADMIN=1.",
           "# Tests must print their names (verbose reporter) so acceptance-criterion IDs (AC-xxx-yy) appear in the log.",
           "# Empty / unset = auto-detect. SKIP = deliberately off (reported as SKIP, never as PASS).",
           f'KIT_STACK="{stack}"   # {desc}',
           f'KIT_MODE="{mode}"     # fast: slow steps in CI only, review optional | strict: all steps locally, '
           f'security-sensitive features need an independent review', ""]
    for k in CFG_KEYS:
        if k in old and old[k]:
            out.append(f'{k}="{old[k]}"')       # your own command survives a stack/mode switch
        else:
            out.append(f'{k}="{cfg[k]}"' if k in cfg else f"# {k}=")
    out += ["# VERIFY_PERF: e.g. npx size-limit | k6 run perf/smoke.js | pytest -m perf   (performance budget)",
            "# VERIFY_MUTATION: e.g. npx stryker run | mutmut run   (proves tests catch bugs; slow: strict + CI)",
            "", "# Steps listed here run only when CI is set (GitHub Actions sets CI=true); the local gate stays fast.",
            f'VERIFY_CI_ONLY="{MODES[mode]}"', "",
            "# Held-out acceptance tests (strict: only an evaluator session may change them) and duplicate-code window",
            *[f'{k}="{old.get(k) or v}"' for k, v in EXTRA_KEYS.items()], "", "VERIFY_TAIL=25"]
    for k, v in keep.items():
        out.append(f'{k}="{v}"')
    (ROOT / "scripts" / "verify.config").write_text("\n".join(out) + "\n")


def _opt(args, name, default=None):
    return args[args.index(name) + 1] if name in args and len(args) > args.index(name) + 1 else default


def _ask(question, default, choices=None):
    if not sys.stdin.isatty():
        return default
    hint = f" [{'/'.join(choices)}]" if choices else ""
    while True:
        ans = input(f"{question}{hint} (default: {default}): ").strip() or default
        if not choices or ans in choices:
            return ans
        print(f"  choose one of: {', '.join(choices)}")


def cmd_config(args):
    if not args:
        v = config_vals()
        print(f"stack={v.get('KIT_STACK', '(not set)')} mode={kit_mode()}")
        for k in CFG_KEYS + ["VERIFY_CI_ONLY"]:
            print(f"  {k:<18}{v.get(k, '(auto-detect)')}")
        print("presets: " + "; ".join(f"{k}: {d}" for k, (d, _) in PRESETS.items()))
        return
    v = config_vals()
    stack = _opt(args, "--stack", v.get("KIT_STACK", "auto"))
    mode = _opt(args, "--mode", v.get("KIT_MODE", "fast"))
    write_config(stack, mode)
    print(f"scripts/verify.config written (stack={stack}, mode={mode}).")
    if has_head():
        print("It is a protected file: commit it yourself with  GUARD_ADMIN=1 git commit -m \"chore: verify config\"")


PLACEHOLDER_FILES = ["AGENTS.md", "docs/product.md", "docs/architecture.md", "docs/DESIGN.md", "docs/decisions.md",
                     "README.md", ".env.example"]


def cmd_init(args):
    d = load()
    if feats(d) and "--force" not in args:
        die("this project already has features; init is for a fresh copy of the kit (use --force to re-run anyway)")
    name = _opt(args, "--name") or _ask("Project name", ROOT.name)
    stack = _opt(args, "--stack") or _ask("Stack preset (auto is fine if you don't know yet)", "auto", list(PRESETS))
    mode = _opt(args, "--mode") or _ask("Mode: fast (solo/MVP) or strict (team/production)", "fast", list(MODES))
    today = time.strftime("%Y-%m-%d")
    for f in PLACEHOLDER_FILES:
        p = ROOT / f
        if p.exists():
            t = p.read_text()
            n = t.replace("{{PROJECT_NAME}}", name).replace("{{DATE}}", today)
            if n != t:
                p.write_text(n)
    write_config(stack, mode)
    cmd_sync_skills([])
    cmd_harden([])
    if not in_git() and shutil.which("git"):
        subprocess.run(["git", "init", "-q"], cwd=ROOT)
        print("git repository initialised")
    if in_git():
        subprocess.run(["bash", str(ROOT / "scripts" / "install-hooks.sh")], cwd=ROOT)
    print(f"\nInitialised '{name}' (stack={stack}, mode={mode}).\nNext:\n"
          f"  1. git add -A && git commit -m \"chore: add AI build kit\"\n"
          f"  2. Plan once: open your agent and run /kickoff (or paste KICKOFF-PROMPT.md) with your idea.\n"
          f"  3. python3 scripts/kit.py doctor   (optional health check)")


def cmd_doctor(_):
    rows = []
    ok = lambda m: rows.append("OK    " + m)
    warn = lambda m: rows.append("WARN  " + m)
    bad = lambda m: rows.append("FAIL  " + m)
    (ok if sys.version_info >= (3, 8) else bad)(f"python {sys.version.split()[0]} (need 3.8+)")
    if not shutil.which("git"):
        bad("git not installed")
    elif not in_git():
        bad("not a git repository: run python3 scripts/kit.py init")
    else:
        hp = git("config", "core.hooksPath").strip()
        (ok if hp == ".githooks" else bad)(f"git hooks path = {hp or '(default)'} (need .githooks: bash scripts/install-hooks.sh)")
        (ok if has_head() else warn)("first commit exists" if has_head() else "no commit yet (guards relax until the first commit)")
    for t, why in (("rg", "fast code search for agents"), ("gitleaks", "secret scan"), ("semgrep", "SAST"),
                   ("osv-scanner", "vulnerability scan")):
        (ok if shutil.which(t) else warn)(f"{t} {'found' if shutil.which(t) else 'missing'} ({why}{'; CI installs it' if t != 'rg' else ''})")
    for name, f in HOOK_FILES.items():
        (ok if "protect.py" in read(f) else warn)(f"guard hook for {name}: {f}" + ("" if "protect.py" in read(f) else " missing"))
    (ok if "protect.py" in read(str(Path.home() / ".codex" / "hooks.json")) else warn)(
        "guard hook for Codex CLI (user-level; `kit.py hooks` shows the one-time setup)")
    oos = skills_out_of_sync()
    (warn if oos else ok)(f"skills out of sync: {', '.join(oos)} (python3 scripts/kit.py sync-skills)" if oos
                          else "skills: .agents/skills and .claude/skills in sync")
    manifests = [m for m in ("package.json", "pyproject.toml", "requirements.txt") if (ROOT / m).exists()]
    if manifests:
        cd = any(k in read(f) for f, k in COOLDOWN.items())
        (ok if cd else warn)("dependency cooldown configured" if cd else "no dependency cooldown: python3 scripts/kit.py harden")
    if "KICKOFF_FILLS_THIS" in read("scripts/dev.sh") and len(load().get("features", [])):
        warn("scripts/dev.sh still a placeholder: write the command that starts the app")
    if not boundary_rules() and len(load().get("features", [])):
        warn("docs/boundaries.txt has no rules: architecture boundaries are not enforced")
    for f in ("scripts/verify.sh", "scripts/kit.py", ".githooks/pre-commit", ".claude/hooks/protect.py"):
        p = ROOT / f
        if p.exists() and os.name != "nt" and not os.access(p, os.X_OK):
            warn(f"{f} not executable (bash scripts/install-hooks.sh fixes it)")
    left = [f for f in PLACEHOLDER_FILES if "{{" in read(f)]
    (warn if left else ok)(f"placeholders still open in: {', '.join(left)} (kickoff fills them)" if left else "no {{placeholders}} left")
    v = config_vals()
    ok(f"verify config: stack={v.get('KIT_STACK', 'auto')} mode={kit_mode()}")
    d = load()
    n = len(feats(d))
    (ok if n else warn)(f"{n} feature(s) planned" if n else "no features yet: run the kickoff (/kickoff or KICKOFF-PROMPT.md)")
    if (AGENT / "plan.json").exists():
        warn("agent/plan.json exists: approve it and run python3 scripts/kit.py import (or delete it)")
    vs = verify_state()
    if n and not vs:
        warn("verify gate never run: bash scripts/verify.sh")
    errs, warns = [], []
    check_features(d, errs, warns)
    (bad if errs else ok)(f"features.json: {len(errs)} error(s), {len(warns)} warning(s)")
    print("\n".join(rows))
    print(f"kit {KIT_VERSION}: " + ("problems found" if any(r.startswith("FAIL") for r in rows) else "healthy"))
    sys.exit(1 if any(r.startswith("FAIL") for r in rows) else 0)


# ---------- plan import (the only way agents create or change features) ----------
def cmd_import(args):
    path = next((a for a in args if not a.startswith("--")), "agent/plan.json")
    p = ROOT / path
    if not p.exists():
        die(f"{path} not found. The agent writes a proposed plan there (same schema as agent/features.json, "
            f"without passes/evidence), the human approves it, then: python3 scripts/kit.py import")
    try:
        plan = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        die(f"{path} is not valid JSON: {e}")
    approved = os.environ.get("SPEC_CHANGE_APPROVED") == "1"
    d = load()
    d.setdefault("requirements", [])
    d.setdefault("features", [])
    errs, log = [], []
    need = lambda what: errs.append(f"{what}: changing existing text needs the human's approval "
                                    f"(re-run as SPEC_CHANGE_APPROVED=1 python3 scripts/kit.py import)")
    reqs = {r["id"]: r for r in d["requirements"]}
    for r in plan.get("requirements", []):
        rid = r.get("id", "")
        if not re.fullmatch(r"REQ-\d{3,}", rid) or not r.get("text"):
            errs.append(f"requirement {rid or '?'}: needs id REQ-001 style and text")
            continue
        cur = reqs.get(rid)
        if not cur:
            d["requirements"].append({k: r[k] for k in ("id", "text", "features", "note") if k in r})
            log.append(f"+ {rid}")
            continue
        if cur.get("text") != r["text"]:
            if not approved:
                need(rid)
                continue
            cur["text"] = r["text"]
            log.append(f"~ {rid} text")
        for k in ("features", "note"):
            if k in r and cur.get(k) != r[k]:
                cur[k] = r[k]
                log.append(f"~ {rid} {k}")
    fmap = {f["id"]: f for f in d["features"]}
    for pf in plan.get("features", []):
        fid = pf.get("id", "")
        m = re.fullmatch(r"FEAT-(\d{3,})", fid)
        if not m or not pf.get("title") or not pf.get("acceptance"):
            errs.append(f"feature {fid or '?'}: needs id FEAT-001 style, title and acceptance criteria")
            continue
        for a in pf["acceptance"]:
            aid = a.get("id", "")
            if not re.fullmatch(rf"AC-{m.group(1)}-\d{{2,}}", aid):
                errs.append(f"{fid}: criterion id '{aid}' must look like AC-{m.group(1)}-01")
            if not a.get("check"):
                errs.append(f"{aid or fid}: criterion has no 'check' text")
        ef = fmap.get(fid)
        if not ef:
            nf = {"id": fid, "title": pf["title"], "priority": pf.get("priority", int(m.group(1))),
                  "depends_on": pf.get("depends_on", []), "origin": pf.get("origin", "USER REQUIREMENT"),
                  "spec": pf.get("spec"), "security_sensitive": bool(pf.get("security_sensitive")),
                  "review_required": bool(pf.get("review_required")),
                  "acceptance": [{"id": a.get("id"), "kind": a.get("kind", "happy"), "check": a.get("check", ""),
                                  "passes": False, "verified_by": "", "evidence": ""} for a in pf["acceptance"]],
                  "status": "todo", "notes": pf.get("notes", "")}
            d["features"].append(nf)
            fmap[fid] = nf
            log.append(f"+ {fid} {pf['title']} ({len(pf['acceptance'])} criteria)")
            continue
        if pf["title"] != ef.get("title"):
            if approved:
                ef["title"] = pf["title"]
                log.append(f"~ {fid} title")
            else:
                need(f"{fid} title")
        for k in ("security_sensitive", "review_required"):
            if k in pf and bool(pf[k]) != bool(ef.get(k)):
                if ef.get(k) and not approved:
                    need(f"{fid} {k} (turning a safety flag off)")
                else:
                    ef[k] = bool(pf[k])
                    log.append(f"~ {fid} {k}={ef[k]}")
        for k in ("priority", "depends_on", "origin", "spec", "notes"):
            if k in pf and pf[k] != ef.get(k):
                ef[k] = pf[k]
                log.append(f"~ {fid} {k}")
        cac = {a["id"]: a for a in ef.get("acceptance", [])}
        reopened = False
        for a in pf["acceptance"]:
            ca = cac.get(a.get("id"))
            if not ca:
                ef["acceptance"].append({"id": a.get("id"), "kind": a.get("kind", "happy"), "check": a.get("check", ""),
                                         "passes": False, "verified_by": "", "evidence": ""})
                log.append(f"+ {a.get('id')}")
                reopened = True
            elif ca.get("check") != a.get("check") or ca.get("kind", "happy") != a.get("kind", ca.get("kind", "happy")):
                if not approved:
                    need(a["id"])
                    continue
                ca.update({"check": a["check"], "kind": a.get("kind", ca.get("kind", "happy")),
                           "passes": False, "verified_by": "", "evidence": ""})
                log.append(f"~ {a['id']} reworded (reset to failing: verify it again)")
                reopened = True
        if reopened and ef.get("status") == "done":
            ef["status"] = "in_progress"
            log.append(f"~ {fid} reopened (done -> in_progress)")
    if not errs:
        verrs, vwarns = [], []
        check_features(d, verrs, vwarns)
        errs += verrs
        log += ["  WARN " + w for w in vwarns]
    print("\n".join(log) or "(nothing to change)")
    if errs:
        print("\n".join("ERROR " + e for e in errs))
        die("import aborted: agent/features.json unchanged", 1)
    if "--dry-run" in args:
        print("dry run: nothing written")
        return
    save(d)
    if "--keep" not in args and path == "agent/plan.json":
        p.unlink()
    print(f"imported {path} -> agent/features.json. Commit it (criteria rewording also needs SPEC_CHANGE_APPROVED=1 on commit).")


# ---------- upgrade (copy kit-owned files from a newer kit) ----------
KIT_OWNED = ["scripts/kit.py", "scripts/verify.sh", "scripts/install-hooks.sh", ".githooks/*", ".claude/hooks/*",
             ".claude/settings.json", ".claude/agents/evaluator.md", ".cursor/hooks.json", ".gemini/settings.json",
             ".github/hooks/kit-guard.json", "docs/specs/SPEC-TEMPLATE.md", "agent/reviews/README.md", "START-HERE.md",
             "KICKOFF-PROMPT.md", "SESSION-PROMPTS.md", "CLAUDE.md", "GEMINI.md"] + \
            [f"{d}/{n}/*" for d in (".agents/skills", ".claude/skills") for n in [
                "kickoff", "feature", "bugfix", "change", "prove", "state", "security", "peer-review", "audit", "perf", "evaluate"]]
UPGRADE_ADDS = ["docs/boundaries.txt", "scripts/dev.sh", "agent/evaluations/README.md", ".github/dependabot.yml"]
LEGACY = ["scripts/arch-ts.sh", "agent/CODEMAP.md", "agent/.codemap-cache.json"] + [
    f"{d}/{n}.md" for d in (".claude/commands", ".opencode/commands", ".agent/workflows")
    for n in ("kickoff", "feature", "bugfix", "change", "prove", "state", "security", "review", "audit")]
KIT_BLOCK = re.compile(r"<!-- KIT:BEGIN.*?<!-- KIT:END -->", re.S)


def cmd_upgrade(args):
    """Always runs the NEWER kit's upgrade logic: an older kit.py doesn't know the newer file list.
    From the project:  python3 scripts/kit.py upgrade /path/to/newer-kit
    Kit 4.0 projects:  cd my-project && python3 /path/to/newer-kit/scripts/kit.py upgrade"""
    flags = [a for a in args if a.startswith("--")]
    pos = [a for a in args if not a.startswith("--")]
    target = Path(_opt(args, "--target") or (ROOT if pos else os.getcwd())).resolve()
    src = Path(pos[0]).resolve() if pos and pos[0] != _opt(args, "--target") else ROOT
    if not (src / "scripts" / "kit.py").exists():
        die("usage: kit.py upgrade /path/to/newer-kit [--dry-run]   (the folder that contains scripts/kit.py)")
    if src != ROOT:  # hand over to the newer kit's own code
        sys.exit(subprocess.call([sys.executable, str(src / "scripts" / "kit.py"), "upgrade", "--target", str(target)]
                                 + [f for f in flags if f != "--target"]))
    if target == ROOT and "--target" not in args:
        die("run this from inside the project: cd my-project && python3 /path/to/newer-kit/scripts/kit.py upgrade")
    if not (target / "agent").exists() and not (target / "AGENTS.md").exists():
        die(f"{target} does not look like a project using the kit")
    dry, changed = "--dry-run" in args, []
    for dp, dn, fn in os.walk(src):
        dn[:] = [x for x in dn if x != ".git"]
        for f in fn:
            rel = str((Path(dp) / f).relative_to(src)).replace("\\", "/")
            if not any(fnmatch.fnmatch(rel, g) for g in KIT_OWNED):
                continue
            dst = target / rel
            new = (Path(dp) / f).read_bytes()
            if dst.exists() and dst.read_bytes() == new:
                continue
            changed.append(rel)
            if not dry:
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(new)
                if os.name != "nt" and os.access(Path(dp) / f, os.X_OK):
                    dst.chmod(0o755)
    cur_agents = (target / "AGENTS.md").read_text(errors="ignore") if (target / "AGENTS.md").exists() else ""
    nb = KIT_BLOCK.search((src / "AGENTS.md").read_text(errors="ignore"))
    if nb and KIT_BLOCK.search(cur_agents) and KIT_BLOCK.search(cur_agents).group(0) != nb.group(0):
        changed.append("AGENTS.md (kit block only; your PROJECT block is untouched)")
        if not dry:
            (target / "AGENTS.md").write_text(KIT_BLOCK.sub(lambda _: nb.group(0), cur_agents, count=1))
    elif nb and not KIT_BLOCK.search(cur_agents):
        changed.append("AGENTS.md has no KIT:BEGIN/END markers: merge the new kit rules by hand")
    for rel in UPGRADE_ADDS:
        if not (target / rel).exists() and (src / rel).exists():   # new project files: add once, never overwrite
            changed.append(f"{rel} (new in this kit version)")
            if not dry:
                (target / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src / rel, target / rel)
    for rel in LEGACY:
        if (target / rel).exists():
            changed.append(f"{rel} (removed: replaced in this kit version)")
            if not dry:
                (target / rel).unlink()
    if not dry:
        for d in (".claude/commands", ".opencode/commands", ".opencode", ".agent/workflows", ".agent"):
            p = target / d
            if p.is_dir() and not any(p.iterdir()):
                p.rmdir()
    print(("would update" if dry else "updated") + f" {len(changed)} file(s):")
    print("\n".join("  " + c for c in changed) or "  (already up to date)")
    if changed and not dry:
        print("Project files (agent/*, docs/*, verify.config, .env.example, CI) were not touched.\n"
              "Next: bash scripts/install-hooks.sh && python3 scripts/kit.py doctor && "
              "git add -A && GUARD_ADMIN=1 git commit -m \"chore: upgrade AI build kit\"")


def cmd_version(_):
    print(f"AI Build Kit {KIT_VERSION}")


CMDS = {"brief": cmd_brief, "status": cmd_status, "check": cmd_check, "dupes": cmd_dupes,
        "where": cmd_where, "show": cmd_show,
        "start": cmd_start, "pass": cmd_pass, "fail": cmd_fail, "done": cmd_done, "block": cmd_block,
        "dep-check": cmd_dep_check, "review-pack": cmd_review_pack,
        "init": cmd_init, "config": cmd_config, "doctor": cmd_doctor, "import": cmd_import, "upgrade": cmd_upgrade,
        "version": cmd_version, "--version": cmd_version, "stop-check": cmd_stop_check, "harden": cmd_harden,
        "hooks": cmd_hooks, "sync-skills": cmd_sync_skills}

if __name__ == "__main__":
    if hasattr(__import__("signal"), "SIGPIPE"):
        __import__("signal").signal(__import__("signal").SIGPIPE, __import__("signal").SIG_DFL)  # `kit.py brief | head`
    if len(sys.argv) < 2 or sys.argv[1] not in CMDS:
        print(__doc__)
        sys.exit(2)
    CMDS[sys.argv[1]](sys.argv[2:])
