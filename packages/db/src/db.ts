import type { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import * as schema from "./schema";

export type BrainDb = ReturnType<typeof pgliteDrizzle<typeof schema>>;

export function fromPglite(client: PGlite): BrainDb {
  return pgliteDrizzle(client, { schema });
}

export function fromPostgres(client: Sql): BrainDb {
  return postgresDrizzle(client, { schema }) as unknown as BrainDb;
}
