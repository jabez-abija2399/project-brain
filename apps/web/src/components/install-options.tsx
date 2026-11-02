import { CommandBox } from "@/components/landing/command-box";
import release from "@/lib/cli-release.json";

// D-027: how to install Codeceipt. The one-line native installers come first (no Node.js needed, updates itself),
// Homebrew and winget are "coming soon" until they are published, and npx is the alternative. Before the first
// native release (apps/web/src/lib/cli-release.json has no version) the installers say so and npx is the command.
export const INSTALL_SH = "curl -fsSL https://codeceipts.vercel.app/install.sh | sh";
export const INSTALL_PS1 = "irm https://codeceipts.vercel.app/install.ps1 | iex";
export const nativeReleased = (): boolean =>
  (release as { version: string | null }).version !== null;

export function InstallOptions({
  released = nativeReleased(),
  tone = "light",
}: { released?: boolean; tone?: "light" | "ink" }) {
  return (
    <div className="install-options">
      <p className="install-label">macOS, Linux, WSL</p>
      {released ? (
        <CommandBox command={INSTALL_SH} tone={tone} />
      ) : (
        <p className="install-soon">
          <code>{INSTALL_SH}</code> (with the first native release)
        </p>
      )}
      <p className="install-label">Windows (PowerShell)</p>
      {released ? (
        <CommandBox command={INSTALL_PS1} tone={tone} />
      ) : (
        <p className="install-soon">
          <code>{INSTALL_PS1}</code> (with the first native release)
        </p>
      )}
      {released ? (
        <p className="install-then">Then run codeceipt in your app&apos;s folder.</p>
      ) : null}
      <p className="install-soon">Homebrew and winget: coming soon.</p>
      <p className="install-label">
        {released
          ? "Or with Node.js, without installing:"
          : "Today, with Node.js, in your app's folder:"}
      </p>
      <CommandBox command="npx codeceipt" tone={tone} />
    </div>
  );
}
