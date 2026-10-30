import { assertProductionEnv } from "./server/env";

// Next.js runs register() once when a server instance starts. In production it refuses to start with a missing or
// malformed environment variable, naming it (never its value), instead of failing later inside a request.
export function register() {
  assertProductionEnv(process.env);
}
