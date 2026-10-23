#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.log("[@brain/db] DATABASE_URL not set; skipping migrations.");
  process.exit(0);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const TRACKING = `CREATE TABLE IF NOT EXISTS "_brain_migrations" (
  "id" text PRIMARY KEY NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now()
);`;

try {
  await sql.unsafe(TRACKING);
  const applied = await sql`SELECT id FROM _brain_migrations`;
  const appliedIds = new Set(applied.map((row) => row.id));
  const entries = (await readdir(migrationsDir)).filter((n) => n.endsWith(".sql")).sort();
  const newlyApplied = [];
  for (const name of entries) {
    const id = name.replace(/\.sql$/, "");
    if (appliedIds.has(id)) continue;
    const body = await readFile(join(migrationsDir, name), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO _brain_migrations (id) VALUES (${id})`;
    });
    newlyApplied.push(id);
  }
  if (newlyApplied.length === 0) {
    console.log("[@brain/db] no new migrations to apply.");
  } else {
    console.log(
      `[@brain/db] applied ${newlyApplied.length} migration(s): ${newlyApplied.join(", ")}`,
    );
  }
} catch (err) {
  console.error("[@brain/db] migrate failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 1 }).catch(() => {});
}
