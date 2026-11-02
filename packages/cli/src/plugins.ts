// D-028: the Codeceipt plugins (packages/agent-plugins), installed once per computer. This module tells whether an
// agent has the plugin, and does the agent part of `npx codeceipt` / `codeceipt connect`: an agent with the plugin
// gets nothing written into the repo; for the others the plugin is offered (installed with the agent's own command
// when it has one and the user says yes), and per-repo files (`codeceipt init`) remain the fallback.
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CliConfig } from "./config";
import { AGENT_NAMES, type Agent, detectAgents, runInit } from "./init-command";
import marketplace from "./plugin-marketplace.json";

/** The published marketplace repository (owner/repo), or null until a human publishes it (docs/plugins.md). */
export const PLUGIN_MARKETPLACE: string | null = (marketplace as { repo: string | null }).repo;
export const PLUGIN_AGENTS = ["claude", "cursor", "codex", "antigravity"] as const;
export type PluginAgent = (typeof PLUGIN_AGENTS)[number];
const PLUGIN_ID = "codeceipt@codeceipt";

const readJson = (file: string): unknown => {
  try {
    return lstatSync(file).isFile() ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
};
const isOurs = (manifest: string) => {
  const doc = readJson(manifest) as { name?: unknown } | null;
  return doc?.name === "codeceipt";
};
// A folder holding our plugin (its manifest under one of the names the agent reads), searched a few levels deep.
function findPlugin(dir: string, manifests: string[], depth: number): boolean {
  if (depth < 0 || !existsSync(dir)) return false;
  if (manifests.some((m) => isOurs(join(dir, m)))) return true;
  let names: string[] = [];
  try {
    names = readdirSync(dir).slice(0, 200);
  } catch {
    return false;
  }
  return names.some((n) => {
    const p = join(dir, n);
    try {
      return (
        !n.startsWith(".") && lstatSync(p).isDirectory() && findPlugin(p, manifests, depth - 1)
      );
    } catch {
      return false;
    }
  });
}

/** Whether this user has the Codeceipt plugin for an agent (installed and enabled where the agent records that). */
export function pluginInstalled(home: string, agent: Agent): boolean {
  if (agent === "claude") {
    const settings = readJson(join(home, ".claude", "settings.json")) as {
      enabledPlugins?: Record<string, unknown>;
    } | null;
    const enabled = settings?.enabledPlugins;
    return (
      !!enabled &&
      typeof enabled === "object" &&
      Object.entries(enabled).some(([id, on]) => id.startsWith("codeceipt@") && on === true)
    );
  }
  if (agent === "codex") {
    let text = "";
    try {
      text = readFileSync(join(home, ".codex", "config.toml"), "utf8");
    } catch {
      return false;
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const at = lines.findIndex((l) => /^\[plugins\."codeceipt@[^"]+"\]$/.test(l));
    if (at === -1) return false;
    for (const line of lines.slice(at + 1)) {
      if (line.startsWith("[")) break;
      if (/^enabled\s*=\s*true\b/.test(line)) return true;
    }
    return false;
  }
  if (agent === "cursor") {
    return findPlugin(
      join(home, ".cursor", "plugins"),
      [".cursor-plugin/plugin.json", "plugin.json"],
      4,
    );
  }
  if (agent === "antigravity") {
    return findPlugin(
      join(home, ".gemini", "config", "plugins"),
      [".antigravity-plugin/plugin.json", "plugin.json"],
      2,
    );
  }
  return false;
}

/** Claude Code's transcript folder for a project: the folder path with every other character than a letter or digit as -. */
export const claudeTranscriptDir = (folder: string) => folder.replace(/[^A-Za-z0-9]/g, "-");

export type AgentSetupDeps = {
  marketplace: string | null;
  stdout: (line: string) => void;
  hasCommand?: (name: string) => boolean;
  /** Asks a yes/no question in the terminal; absent when nobody can answer (no terminal). */
  ask?: (question: string) => Promise<boolean>;
  /** Runs an agent's own command (no shell); true when it succeeded. */
  run?: (command: string, args: string[]) => Promise<boolean>;
};

const LATER = "then `codeceipt init --remove-repo-files` here";
const howToInstall = (agent: PluginAgent, repo: string): string =>
  agent === "claude"
    ? `in Claude Code run /plugin marketplace add ${repo}, then /plugin install ${PLUGIN_ID}; ${LATER}`
    : agent === "codex"
      ? `run codex plugin marketplace add ${repo} and install Codeceipt from Codex's plugins; ${LATER}`
      : agent === "cursor"
        ? `in Cursor open Customize, Plugins and install Codeceipt; ${LATER}`
        : `in Antigravity open Customizations, Marketplace and install Codeceipt; ${LATER}`;

async function offerClaudePlugin(repo: string, deps: AgentSetupDeps): Promise<boolean> {
  if (!deps.ask || !deps.run || !deps.hasCommand?.("claude")) return false;
  const yes = await deps.ask(
    "Install the Codeceipt plugin for Claude Code? It works in every repo on this computer, with nothing written into the repo. [Y/n]",
  );
  if (!yes) return false;
  return (
    (await deps.run("claude", ["plugin", "marketplace", "add", repo])) &&
    (await deps.run("claude", ["plugin", "install", PLUGIN_ID, "--scope", "user"]))
  );
}

/**
 * The agent part of setup. Returns the summary's agent list ("Claude Code (plugin) and Cursor"); throws the same
 * CliError as init when no supported agent is found.
 */
export async function setupAgents(
  root: string,
  home: string,
  config: CliConfig,
  deps: AgentSetupDeps,
): Promise<{ agents: string }> {
  const found = detectAgents(root, home, []);
  if (found.length === 0) runInit(root, home, config, []);
  const viaPlugin: Agent[] = [];
  const repoFiles: Agent[] = [];
  for (const agent of found) {
    const pluginAgent = (PLUGIN_AGENTS as readonly string[]).includes(agent)
      ? (agent as PluginAgent)
      : null;
    if (pluginAgent && pluginInstalled(home, agent)) {
      viaPlugin.push(agent);
    } else if (pluginAgent && deps.marketplace) {
      const installed =
        pluginAgent === "claude" ? await offerClaudePlugin(deps.marketplace, deps) : false;
      if (installed) viaPlugin.push(agent);
      else {
        repoFiles.push(agent);
        deps.stdout(`  Plugin:  ${howToInstall(pluginAgent, deps.marketplace)}`);
      }
    } else {
      repoFiles.push(agent);
    }
  }
  if (repoFiles.length > 0) {
    runInit(
      root,
      home,
      config,
      repoFiles.map((a) => `--${a}`),
    );
  }
  const names = found.map((a) => `${AGENT_NAMES[a]}${viaPlugin.includes(a) ? " (plugin)" : ""}`);
  const agents =
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return { agents };
}
