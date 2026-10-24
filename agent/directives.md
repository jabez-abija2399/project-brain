# User directives (the user's standing instructions; the agent appends, never deletes; keep under 40 lines)
# Format: - YYYY-MM-DD: <instruction, verbatim or tight paraphrase>
- 2026-10-23: Trial uses the Next.js-only stack (no separate backend server); switch to the Stage 2 stack only after paying users.
- 2026-10-23: Build the MVP first (P1 features); everything else waits in agent/later.md.
- 2026-10-23: Claude Code and Cursor are the first agents; first target codebases are React/Next.js + Supabase.
- 2026-10-23: Explain what you built in plain language at the end of each session; I review every security-sensitive change.
- 2026-10-23: Dogfood: once the MCP server works (FEAT-011), connect it to the sessions building this project.
- 2026-10-23: No Docker. Use a Supabase dev project for development and PGlite for tests.
- 2026-10-23: Use Neon (not Supabase) for our own database: a 'dev' branch for development; tests stay on PGlite. Supabase remains a supported target stack for users' apps.
- 2026-10-23: Parsing: FEAT-004 uses the TypeScript Compiler API (D-011); FEAT-005 uses a hand-written SQL reader, no libpg-query (D-012).
- 2026-10-24: Token API responses use an allowlist: list and create return only id, createdAt, lastUsedAt, revokedAt (create also returns the plaintext token once); the create response key is `id`, not `tokenId`.
- 2026-10-24: Dependency cooldown is 7 days (minimumReleaseAge 10080, D-013); security fixes may bypass it only with human approval.
- 2026-10-24: FEAT-005 switches from the hand-written SQL reader to libpg-query (supersedes the 2026-10-23 D-012 line); tables and policies keyed by schema.name (default public); per-statement parse errors with file and line.
- 2026-10-25: FEAT-005 replays migrations in file order like Postgres (DROP/ALTER/RENAME TABLE, DROP/ALTER POLICY); policies keep permissive/restrictive (restrictive never counts as allowing everyone); a table touched by an unreadable statement gets RLS state unknown, never enabled.
