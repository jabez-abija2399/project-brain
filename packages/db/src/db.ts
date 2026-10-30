// Type-only: the BrainDb type is drizzle's PGlite flavour (the same query API); no PGlite code is loaded here, so the
// web server bundle stays free of it. Tests build a PGlite db with fromPglite from "@brain/db/testing".
import type { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import * as schema from "./schema";

export type BrainDb = ReturnType<typeof pgliteDrizzle<typeof schema>>;

export function fromPostgres(client: Sql): BrainDb {
  return postgresDrizzle(client, { schema }) as unknown as BrainDb;
}
