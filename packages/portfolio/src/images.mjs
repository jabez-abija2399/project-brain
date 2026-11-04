// `pnpm portfolio:images`: regenerates docs/portfolio. Needs a production build of the web app first
// (`pnpm --filter @brain/web exec next build`) and the built CLI (`pnpm --filter @brain/cli build`).
// Starts the demo server, runs the real CLI (`codeceipt last`, `--evidence`) in a throwaway git repo, takes the
// screenshots, then stops everything.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const cli = fileURLToPath(new URL("../../cli/dist/codeceipt.mjs", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "codeceipt-portfolio-"));
const state = join(work, "state.json");
const cliOut = join(work, "cli");
mkdirSync(cliOut);
if (!existsSync(cli)) throw new Error("Build the CLI first: pnpm --filter @brain/cli build");

const server = spawn(process.execPath, [join(here, "demo-server.mjs")], {
  env: { ...process.env, PORTFOLIO_STATE: state },
  stdio: ["ignore", "inherit", "inherit"],
});
try {
  for (let i = 0; i < 240 && !existsSync(state); i++) await new Promise((r) => setTimeout(r, 500));
  if (!existsSync(state)) throw new Error("the demo server did not start");
  const { appPort, projectToken } = JSON.parse(readFileSync(state, "utf8"));

  // A throwaway repo linked with the real `codeceipt login`, then the real `codeceipt last`.
  const repo = join(work, "salon-booking");
  mkdirSync(repo);
  const home = join(work, "home");
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    NO_COLOR: "1",
  };
  const git = (...a) => execFileSync("git", a, { cwd: repo, env });
  git("init", "-q");
  git(
    "-c",
    "user.email=demo@example.com",
    "-c",
    "user.name=demo",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  const codeceipt = (...a) =>
    execFileSync(process.execPath, [cli, ...a], {
      cwd: repo,
      env: { ...env, CODECEIPT_TOKEN: projectToken },
    }).toString();
  codeceipt("login", "--api-url", `http://localhost:${appPort}`);
  writeFileSync(join(cliOut, "last.txt"), codeceipt("last"));
  writeFileSync(join(cliOut, "evidence.txt"), codeceipt("last", "--evidence"));

  execFileSync(process.execPath, [join(here, "shots.mjs")], {
    env: { ...process.env, PORTFOLIO_STATE: state, PORTFOLIO_CLI_OUT: cliOut },
    stdio: "inherit",
  });
} finally {
  server.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
}
