import { execFileSync } from "node:child_process";
import { type CliConfig, saveProjectToken } from "./config";
import { writeRepoLink } from "./repo-link";

/**
 * Test setup: what `codeceipt login` (or `npx codeceipt`) leaves behind for a repo (D-020): the project's token in the
 * user config and the repo linked to that project. The repo must already be a git repo.
 */
export function linkRepo(repo: string, configFile: string, config: CliConfig): void {
  saveProjectToken(configFile, config);
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repo })
    .toString()
    .trim();
  if (!writeRepoLink(gitDir, { apiUrl: config.apiUrl, projectId: config.projectId })) {
    throw new Error("could not link the test repo");
  }
}
