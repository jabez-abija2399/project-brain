import type { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import type { BrainDb } from "./db";
import * as schema from "./schema";

// Tests only (PGlite, in process). Kept out of the package root so the web server never bundles PGlite; import it
// from "@brain/db/testing".
export function fromPglite(client: PGlite): BrainDb {
  return pgliteDrizzle(client, { schema });
}
