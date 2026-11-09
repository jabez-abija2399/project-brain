import { hookBoundaries } from "@/server/hook-boundaries";
import { indexRoute } from "@/server/index-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Roadmap Phase 5: the guard's boundaries. The project comes only from the URL, checked against the token (404
// otherwise); the same per-token and per-project rate limits as the CLI's other hook routes.
export const GET = indexRoute(
  "hooks.boundaries",
  async (db, projectId) => hookBoundaries(db, projectId),
  { limit: "guard" },
);
