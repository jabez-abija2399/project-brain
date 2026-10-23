#!/usr/bin/env node
// Walking skeleton: no tables yet. FEAT-002 adds the schema and real migrations.
const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.log("[@brain/db] DATABASE_URL not set; skipping migrations.");
  process.exit(0);
}
console.log("[@brain/db] no migrations yet (schema arrives in FEAT-002).");
process.exit(0);
