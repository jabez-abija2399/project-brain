import { assertProductionEnv } from "./server/env";

// Next.js runs register() once when a server instance starts. In production it refuses to start with a missing or
// malformed environment variable, naming it (never its value), instead of failing later inside a request.
export function register() {
  // Synchronous on purpose: a missing variable stops the server before it serves anything.
  assertProductionEnv(process.env);
  // A database behind the code (a migration not run before deploy) is logged in the background, naming the migration.
  // Next.js replaces NEXT_RUNTIME at build time, so the edge build drops this import and its Node-only database code.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    void import("./instrumentation-node").then((m) => m.logMissingMigrations());
  }
}
