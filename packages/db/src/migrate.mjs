#!/usr/bin/env node
import postgres from "postgres";
import { runMigrations } from "./migrations-core.mjs";

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.log("[@brain/db] DATABASE_URL not set; skipping migrations.");
  process.exit(0);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

// Adapts a postgres.js client (or the tx handle from sql.begin) to the runner's driver.
function driver(client) {
  return {
    exec: async (text) => {
      await client.unsafe(text);
    },
    query: async (text) => [...(await client.unsafe(text))],
    transaction: (fn) => sql.begin((tx) => fn(driver(tx))),
  };
}

try {
  const { applied: newlyApplied } = await runMigrations(driver(sql));
  if (newlyApplied.length === 0) {
    console.log("[@brain/db] no new migrations to apply.");
  } else {
    console.log(
      `[@brain/db] applied ${newlyApplied.length} migration(s): ${newlyApplied.join(", ")}`,
    );
  }
} catch (err) {
  // postgres.js errors often have the useful bits in .code/.detail/.hint/.where,
  // not .message, so print everything we know.
  const info = {};
  if (err && typeof err === "object") {
    for (const k of [
      "message",
      "name",
      "code",
      "severity",
      "detail",
      "hint",
      "schema",
      "table",
      "column",
      "constraint",
      "where",
      "position",
      "query",
    ]) {
      const v = /** @type {Record<string, unknown>} */ (err)[k];
      if (v !== undefined && v !== "") info[k] = v;
    }
  }
  console.error("[@brain/db] migrate failed:", Object.keys(info).length ? info : err);
  if (err && typeof err === "object" && "stack" in err) console.error(err.stack);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 1 }).catch(() => {});
}
