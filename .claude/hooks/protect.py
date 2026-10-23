#!/usr/bin/env python3
"""AI Build Kit guard hook: deterministic checks that run BEFORE an agent's tool call.
One script for every agent:  python3 .claude/hooks/protect.py [--agent claude|cursor|gemini|copilot|codex]
Blocks:
 1) hand edits of agent/features.json and of guard files (edit tools AND shell writes: redirects, tee, sed -i, cp/mv/rm,
    inline python/node writes); strict mode: evaluator-only files unless KIT_ROLE=evaluator
 2) reading secrets (.env files) through file tools or the shell (.env.example/.sample/.template stay readable)
 3) agents setting the human-only override variables, `git commit --no-verify` and changing git's hook path
 4) installing a NAMED package that is not recorded in docs/dependencies.md or docs/decisions.md
Exit code 2 + a message blocks the call (Claude Code, Cursor, Gemini, Codex); Copilot gets a JSON deny on stdout."""
import fnmatch, json, os, re, shlex, sys

AGENT = sys.argv[sys.argv.index("--agent") + 1] if "--agent" in sys.argv else "claude"


def allow():
    if AGENT == "cursor":  # Cursor treats empty output from a permission hook as invalid (= blocked)
        print(json.dumps({"permission": "allow"}))
    sys.exit(0)


try:
    data = json.load(sys.stdin)
except Exception:
    allow()

root = (os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get("GEMINI_PROJECT_DIR") or os.environ.get("CURSOR_PROJECT_DIR")
        or data.get("cwd") or os.getcwd())

# ---- normalize the different input formats into (tool, file_path, command) ----
tool = data.get("tool_name") or data.get("toolName") or ""
ti = data.get("tool_input") if "tool_input" in data else data.get("toolArgs", {})
if isinstance(ti, str):
    try:
        ti = json.loads(ti)
    except Exception:
        ti = {"command": ti}
ti = ti if isinstance(ti, dict) else {}
command = data.get("command") if AGENT == "cursor" and "command" in data else (ti.get("command") or ti.get("cmd") or "")
if isinstance(command, list):
    command = " ".join(map(str, command))
path = next((ti.get(k) for k in ("file_path", "absolute_path", "path", "filePath", "target_file", "notebook_path")
             if isinstance(ti.get(k), str)), "") or (data.get("file_path") if AGENT == "cursor" else "")
reading = "--read" in sys.argv or (bool(re.search(r"read|view|cat|open|grep|glob|search|ls", tool, re.I))
                                     and not re.search(r"write|edit|replace|create", tool, re.I))


def block(msg):
    msg = "BLOCKED by the AI build kit: " + msg
    if AGENT == "copilot":
        print(json.dumps({"permissionDecision": "deny", "permissionDecisionReason": msg}))
        sys.exit(0)
    if AGENT == "cursor":
        print(json.dumps({"permission": "deny", "user_message": msg, "agent_message": msg}))
    print(msg, file=sys.stderr)
    sys.exit(2)


def cfg(key, default=""):
    try:
        for l in open(os.path.join(root, "scripts/verify.config"), errors="ignore"):
            m = re.match(rf'\s*{key}="?([^"#\s]*)', l)
            if m:
                return m.group(1)
    except OSError:
        pass
    return default


PROTECTED = ["scripts/kit.py", "scripts/verify.sh", "scripts/install-hooks.sh", "scripts/verify.config",
             ".claude/settings.json", ".claude/hooks/*", ".claude/agents/evaluator.md", ".githooks/*",
             ".cursor/hooks.json", ".gemini/settings.json", ".github/hooks/*", ".npmrc", "uv.toml", "bunfig.toml"]
STRICT = cfg("KIT_MODE", "fast") == "strict"
ROLE_FILES = ["agent/evaluations/*", "agent/reviews/*", cfg("ACCEPTANCE_GLOB", "tests/acceptance/*")]
SECRET = re.compile(r"(^|/)\.env(\.[\w.-]+)?$")
SECRET_OK = re.compile(r"\.(example|sample|template|dist)$")
OVERRIDES = ("GUARD_ADMIN", "SPEC_CHANGE_APPROVED", "KIT_ROLE", "KIT_ALLOW_TEST_DELETE", "KIT_ALLOW_TEST_CHANGE",
             "KIT_SKIP_VERIFY_CHECK", "KIT_MODE", "KIT_BASE")


def rel_of(p):
    p = p.strip("'\"")
    full = p if os.path.isabs(p) else os.path.join(data.get("cwd") or os.getcwd(), p)
    return os.path.normpath(os.path.relpath(full, root)).replace("\\", "/")


def is_secret(p):
    r = rel_of(p)
    return bool(SECRET.search(r)) and not SECRET_OK.search(r)


def guard_write(p):
    r = rel_of(p)
    if r.endswith("agent/features.json"):
        block("do not edit agent/features.json by hand. Status: python3 scripts/kit.py start|pass|fail|done|block. "
              "New or changed features: write agent/plan.json, get the human's approval, then python3 scripts/kit.py import.")
    if os.environ.get("GUARD_ADMIN") != "1" and any(fnmatch.fnmatch(r, g) for g in PROTECTED):
        block(f"{r} is a protected guard file. Ask the human to change it.")
    if STRICT and os.environ.get("KIT_ROLE") not in ("evaluator", "reviewer") and any(fnmatch.fnmatch(r, g) for g in ROLE_FILES):
        block(f"{r} is written only by an evaluator/reviewer session (strict mode). The builder may not change it.")
    if is_secret(p):
        block(f"{r} holds secrets; agents don't write it. Put the variable name in .env.example and ask the human.")


# ---- 1+2. file tools ----
if path:
    if reading:
        if is_secret(path):
            block(f"{rel_of(path)} holds secrets and is not readable by agents. Read .env.example for variable names.")
    else:
        guard_write(path)

# ---- shell commands ----
if command:
    cmd = command
    # 3. human-only switches
    for v in OVERRIDES:
        if re.search(rf"(^|[\s;&|(]){v}=", cmd) or re.search(rf"\bexport\s+{v}\b", cmd):
            block(f"{v} is a human-only override; agents may not set it. Ask the human.")
    if re.search(r"\bgit\b[^|;&]*\bcommit\b[^|;&]*(\s--no-verify\b|\s-[a-zA-Z]*n[a-zA-Z]*\b)", cmd):
        block("git commit --no-verify skips the kit guard. Fix what the hook reports instead.")
    if re.search(r"\bgit\b[^|;&]*\bconfig\b[^|;&]*core\.hooksPath", cmd) and "--get" not in cmd:
        block("changing core.hooksPath disables the kit guard.")
    # 1. writes through the shell
    for target in re.findall(r"(?<![<0-9&])>>?\|?\s*([^\s;&|<>]+)", cmd):
        if not target.startswith("&") and target != "/dev/null":
            guard_write(target)
    for seg in re.split(r"&&|\|\||;|\||\n", cmd):
        try:
            toks = shlex.split(seg)
        except ValueError:
            continue
        while toks and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]) or toks[0] in ("sudo", "env", "command", "time")):
            toks.pop(0)
        if not toks:
            continue
        prog, args = os.path.basename(toks[0]), [t for t in toks[1:] if not t.startswith("-")]
        if prog in ("tee", "rm", "unlink", "truncate", "mv", "chmod", "ln", "shred") or (
                prog in ("sed", "perl") and any(t.startswith("-i") or t == "-pi" for t in toks[1:])):
            for t in args:
                guard_write(t)
        elif prog in ("cp", "install", "rsync") and args:
            guard_write(args[-1])
        # 2. secrets read through the shell
        if prog in ("cat", "less", "more", "head", "tail", "grep", "rg", "egrep", "awk", "sed", "strings", "xxd", "od",
                    "base64", "bat", "nl", "cut", "sort", "uniq", "diff", "cp", "mv", "scp", "curl", "wget", "type", "source", "."):
            for t in toks[1:]:
                if "=" not in t and is_secret(t):
                    block(f"{rel_of(t)} holds secrets and is not readable by agents. Use .env.example for variable names.")
    if re.search(r"\b(python3?|node|deno|bun|ruby|perl)\b[^\n]*\s-[ce]\b", cmd):
        if re.search(r"write|unlink|remove|rename|replace\(|truncate|dump\(", cmd):
            for g in ["agent/features.json"] + PROTECTED:
                if re.search(fnmatch.translate(g).replace(r"\Z", "").replace("(?s:", "(?:"), cmd):
                    guard_write(g.replace("*", "x"))
        if re.search(r"""['"](?:[^'"]*/)?\.env(?:\.(?!example|sample|template)[\w.-]+)?['"]""", cmd):
            block(".env holds secrets and is not readable by agents.")

    # ---- 4. dependency install guard ----
    decisions = ""
    for f in ("docs/decisions.md", "docs/dependencies.md"):
        try:
            decisions += open(os.path.join(root, f), errors="ignore").read().lower()
        except OSError:
            pass
    ADD = {"npm": {"install", "i", "add"}, "pnpm": {"add", "install", "i"}, "yarn": {"add"}, "bun": {"add", "install", "i"},
           "pip": {"install"}, "pip3": {"install"}, "uv": {"add"}, "poetry": {"add"}, "cargo": {"add"},
           "go": {"get"}, "composer": {"require"}, "bundle": {"add"}, "gem": {"install"}}
    VALUE_FLAGS = {"-r", "-c", "-e", "--requirement", "--constraint", "--editable", "-i", "--index-url", "--extra-index-url",
                   "--prefix", "--target", "-t", "--registry", "--cwd", "--python", "-p", "--filter", "-F", "-w", "--workspace"}
    for seg in re.split(r"&&|\|\||;|\||\n", cmd):
        try:
            toks = shlex.split(seg)
        except ValueError:
            continue
        while toks and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]):
            toks.pop(0)
        if toks and toks[0] in ("sudo", "time", "npx", "env"):
            toks = toks[1:] if toks[0] != "npx" else []
        if toks[:3] in (["python", "-m", "pip"], ["python3", "-m", "pip"]):
            toks = ["pip"] + toks[3:]
        elif toks[:2] == ["uv", "pip"]:
            toks = ["pip"] + toks[2:]
        if len(toks) >= 3 and toks[0] in ("pnpm", "yarn", "npm") and toks[1] in ("--filter", "-F", "-w", "--workspace", "-C", "--dir"):
            toks = [toks[0]] + toks[3:]
        if len(toks) < 2 or toks[0] not in ADD or toks[1] not in ADD[toks[0]]:
            continue
        rest = toks[2:]
        if any(t in ("-g", "--global", "--user") for t in rest) or any(t in ("-r", "--requirement") for t in rest):
            continue
        pkgs, skip = [], False
        for t in rest:
            if skip:
                skip = False
                continue
            if t in VALUE_FLAGS:
                skip = True
                continue
            if t.startswith("-") or t in (".", "..") or re.match(r"^(\.|/|~|https?:|git\+|git@|file:|workspace:)", t):
                continue
            pkgs.append(t)
        for t in pkgs:
            name = t
            if toks[0] in ("npm", "pnpm", "yarn", "bun"):
                name = t[: t.rfind("@")] if t.rfind("@") > 0 else t
            elif toks[0] in ("pip", "uv", "poetry"):
                name = re.split(r"[<>=!~\[;@ ]", t)[0]
            elif toks[0] in ("go", "cargo"):
                name = t.split("@")[0]
            if name and not re.search(r"(?<![\w@/.\-])" + re.escape(name.lower()) + r"(?![\w\-])", decisions):
                block(f"new dependency '{name}' is not recorded in docs/dependencies.md. Run `python3 scripts/kit.py "
                      f"dep-check {name}` (exists? maintained? license? young?), compare 2 alternatives, add a row to "
                      f"docs/dependencies.md, then install. LLMs invent package names; attackers register them.")
allow()
