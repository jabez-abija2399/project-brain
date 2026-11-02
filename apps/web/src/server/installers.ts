// D-027: the one-line installers served from the site (/install.sh for macOS, Linux and WSL; /install.ps1 for
// Windows PowerShell). They pin one release (apps/web/src/lib/cli-release.json, set by a reviewed PR after each
// release) and the SHA-256 of every file in it: a file is installed only when its checksum matches the one the site
// pins, so a changed GitHub asset is refused. HTTPS only, no sudo, a user folder, PATH, then the next step.
// The scripts are fixed templates; the version and checksums are checked against strict patterns before they are put
// in, so nothing from the release file can add shell or PowerShell code.

export type CliRelease = { version: string | null; sha256: Record<string, string> };

const RELEASES = "https://github.com/jabez-abija2399/project-brain/releases/download";
const SITE = "https://codeceipts.vercel.app";
const POSIX_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
  "linux-arm64-musl",
] as const;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const SHA = /^[0-9a-f]{64}$/;

function checked(release: CliRelease): { version: string; sha: Record<string, string> } | null {
  if (release.version === null) return null;
  if (!VERSION.test(release.version)) throw new Error("cli-release.json: invalid version");
  for (const [target, value] of Object.entries(release.sha256)) {
    if (!SHA.test(value)) throw new Error(`cli-release.json: invalid sha256 for ${target}`);
  }
  return { version: release.version, sha: release.sha256 };
}

const SH = String.raw`#!/bin/sh
# Codeceipt installer for macOS, Linux and WSL: ${SITE}/install.sh
# Installs the native app (no Node.js needed) into ~/.local/bin, or CODECEIPT_INSTALL_DIR, without sudo.
# Pinned release: __VERSION__. Every download is checked against the SHA-256 below before it is installed.
# Everything runs inside main(), called on the last line, so a download cut off halfway runs nothing.
set -eu

main() {

VERSION="__VERSION__"
say() { printf '%s\n' "$*"; }
fail() { printf 'Codeceipt install: %s\n' "$*" >&2; exit 1; }

if [ -z "$VERSION" ]; then
  fail "the native app is not released yet. Use Codeceipt through Node.js for now: npx codeceipt"
fi
RELEASE_URL="__RELEASES__/cli-v__VERSION__"

os="$(uname -s)"
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "there is no native build for $arch; use: npx codeceipt" ;;
esac
case "$os" in
  Darwin) target="darwin-$arch" ;;
  Linux)
    if [ -e /lib/ld-musl-x86_64.so.1 ] || [ -e /lib/ld-musl-aarch64.so.1 ] || (ldd --version 2>&1 | grep -qi musl); then
      target="linux-$arch-musl"
    else
      target="linux-$arch"
    fi
    ;;
  *) fail "there is no native build for $os. On Windows, in PowerShell: irm ${SITE}/install.ps1 | iex" ;;
esac
# An Intel shell under Rosetta on Apple Silicon reports x86_64: install the native arm64 build.
if [ "$os" = Darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  target=darwin-arm64
fi

case "$target" in
__SHA_CASES__
  *) fail "there is no native build for $target; use: npx codeceipt" ;;
esac

dir="$(printenv CODECEIPT_INSTALL_DIR || true)"
[ -n "$dir" ] || dir="$HOME/.local/bin"
mkdir -p "$dir" || fail "cannot create $dir"
tmp="$dir/.codeceipt-download.$$"
trap 'rm -f "$tmp"' EXIT INT TERM

say "Downloading Codeceipt $VERSION for $target..."
if command -v curl >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -fsSL "$RELEASE_URL/codeceipt-$target" -o "$tmp" || fail "the download failed"
elif command -v wget >/dev/null 2>&1; then
  wget --https-only -q -O "$tmp" "$RELEASE_URL/codeceipt-$target" || fail "the download failed"
else
  fail "curl or wget is needed to download Codeceipt"
fi

if command -v sha256sum >/dev/null 2>&1; then
  got="$(sha256sum "$tmp" | cut -d' ' -f1)"
elif command -v shasum >/dev/null 2>&1; then
  got="$(shasum -a 256 "$tmp" | cut -d' ' -f1)"
else
  fail "sha256sum or shasum is needed to check the download"
fi
[ "$got" = "$want" ] || fail "checksum mismatch: the download is not the published file, so nothing was installed"

chmod 755 "$tmp"
# Checked before it replaces anything, so a build that cannot run here leaves a working install alone.
"$tmp" --version >/dev/null 2>&1 || fail "this build does not run on this system, so nothing was installed; use: npx codeceipt"
mv -f "$tmp" "$dir/codeceipt"

# Migrating from npm: a global npm copy could run instead of this one. Your login and settings are kept either way.
if [ "$(printenv CODECEIPT_KEEP_NPM || true)" != 1 ] && command -v npm >/dev/null 2>&1 && npm ls -g codeceipt --depth=0 >/dev/null 2>&1; then
  if npm uninstall -g codeceipt >/dev/null 2>&1; then
    say "Removed the npm copy of codeceipt (your login and settings are kept)."
  else
    say "An npm copy of codeceipt is still installed; remove it with: npm uninstall -g codeceipt"
  fi
fi

case ":$PATH:" in
  *":$dir:"*) on_path=1 ;;
  *) on_path=0 ;;
esac
if [ "$on_path" = 0 ]; then
  if [ "$dir" = "$HOME/.local/bin" ]; then line='export PATH="$HOME/.local/bin:$PATH"'; else line="export PATH=\"$dir:\$PATH\""; fi
  case "$(basename "$(printenv SHELL || echo sh)")" in
    zsh) rc="$HOME/.zshrc" ;;
    bash) if [ "$os" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
    fish) rc="" ; mkdir -p "$HOME/.config/fish/conf.d" && printf "fish_add_path '%s'\n" "$dir" > "$HOME/.config/fish/conf.d/codeceipt.fish" ;;
    *) rc="$HOME/.profile" ;;
  esac
  if [ -n "$rc" ]; then
    grep -qsF "$line" "$rc" || printf '\n# Added by the Codeceipt installer\n%s\n' "$line" >> "$rc"
  fi
fi

say ""
say "Codeceipt $VERSION is installed: $dir/codeceipt"
other="$(command -v codeceipt 2>/dev/null || true)"
if [ "$on_path" = 1 ] && [ -n "$other" ] && [ "$other" != "$dir/codeceipt" ]; then
  say "Note: another codeceipt at $other runs first. Remove it, or put $dir earlier in PATH."
fi
if [ "$on_path" = 0 ]; then
  say "Open a new terminal (or run: export PATH=\"$dir:\$PATH\") so the codeceipt command is found."
fi
say ""
say "Next: cd into your app's folder and run:"
say "  codeceipt"
say "Connected a repo with npx before? Run codeceipt init in it once, so its hooks use this install."
say "Check everything with: codeceipt doctor"
}

main "$@"
`;

const PS1 = String.raw`# Codeceipt installer for Windows PowerShell: ${SITE}/install.ps1
# Installs the native app (no Node.js needed) into %USERPROFILE%\.local\bin for this user only (no administrator).
# Pinned release: __VERSION__. The download is checked against the SHA-256 below before it is installed.
$ErrorActionPreference = "Stop"
$Version = "__VERSION__"
$Sha256 = "__WINDOWS_SHA__"
if (-not $Version) {
  Write-Error "Codeceipt: the native app is not released yet. Use it through Node.js for now: npx codeceipt"
  exit 1
}
if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64" -and $env:PROCESSOR_ARCHITEW6432 -ne "AMD64") {
  Write-Error "Codeceipt: there is no native build for this processor yet; use: npx codeceipt"
  exit 1
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Url = "__RELEASES__/cli-v__VERSION__/codeceipt-windows-x64.exe"
$Dir = Join-Path $env:USERPROFILE ".local\bin"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Tmp = Join-Path $Dir ".codeceipt-download.exe"
Write-Output "Downloading Codeceipt $Version for Windows x64..."
Invoke-WebRequest -Uri $Url -OutFile $Tmp -UseBasicParsing
$Got = (Get-FileHash -Path $Tmp -Algorithm SHA256).Hash.ToLowerInvariant()
if ($Got -ne $Sha256) {
  Remove-Item -Force $Tmp
  Write-Error "Codeceipt: checksum mismatch: the download is not the published file, so nothing was installed."
  exit 1
}
# Checked before it replaces anything, so a build that cannot run here leaves a working install alone.
& $Tmp --version | Out-Null
if ($LASTEXITCODE -ne 0) {
  Remove-Item -Force $Tmp
  Write-Error "Codeceipt: this build does not run on this system, so nothing was installed; use: npx codeceipt"
  exit 1
}
$Exe = Join-Path $Dir "codeceipt.exe"
if (Test-Path $Exe) {
  # A running codeceipt.exe cannot be replaced, but it can be renamed; the old file is removed on its next start.
  Remove-Item -Force -ErrorAction SilentlyContinue "$Exe.old"
  Move-Item -Force $Exe "$Exe.old"
}
Move-Item -Force $Tmp $Exe

if ($env:CODECEIPT_KEEP_NPM -ne "1" -and (Get-Command npm -ErrorAction SilentlyContinue)) {
  npm ls -g codeceipt --depth=0 *> $null
  if ($LASTEXITCODE -eq 0) {
    npm uninstall -g codeceipt *> $null
    if ($LASTEXITCODE -eq 0) { Write-Output "Removed the npm copy of codeceipt (your login and settings are kept)." }
    else { Write-Output "An npm copy of codeceipt is still installed; remove it with: npm uninstall -g codeceipt" }
  }
}

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $UserPath) { $UserPath = "" }
if (($UserPath -split ";") -notcontains $Dir) {
  [Environment]::SetEnvironmentVariable("Path", (($UserPath.TrimEnd(";") + ";" + $Dir).TrimStart(";")), "User")
  $env:Path = "$env:Path;$Dir"
  Write-Output "Added $Dir to your PATH. Open a new terminal so the codeceipt command is found."
}
Write-Output ""
Write-Output "Codeceipt $Version is installed: $Exe"
Write-Output ""
Write-Output "Next: cd into your app's folder and run:"
Write-Output "  codeceipt"
Write-Output "Connected a repo with npx before? Run codeceipt init in it once, so its hooks use this install."
Write-Output "Check everything with: codeceipt doctor"
`;

/** The POSIX installer for this release (or one that explains there is no native release yet). */
export function installSh(release: CliRelease): string {
  const r = checked(release);
  const cases = r
    ? POSIX_TARGETS.filter((t) => r.sha[t]).map((t) => `  ${t}) want="${r.sha[t]}" ;;`)
    : [];
  return SH.replaceAll("__VERSION__", r?.version ?? "")
    .replace("__RELEASES__", RELEASES)
    .replace("__SHA_CASES__", cases.join("\n"));
}

/** The Windows PowerShell installer for this release. */
export function installPs1(release: CliRelease): string {
  const r = checked(release);
  const windows = r?.sha["windows-x64"];
  return PS1.replaceAll("__VERSION__", r && windows ? r.version : "")
    .replace("__WINDOWS_SHA__", windows ?? "")
    .replace("__RELEASES__", RELEASES);
}

export function scriptResponse(text: string): Response {
  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      // Short: a new release is served within minutes of its PR merging.
      "cache-control": "public, max-age=300",
    },
  });
}
