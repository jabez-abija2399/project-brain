# User directives (the user's standing instructions; the agent appends, never deletes; keep under 40 lines)
# Format: - YYYY-MM-DD: <instruction, verbatim or tight paraphrase>
- 2026-10-23: Trial uses the Next.js-only stack (no separate backend server); switch to the Stage 2 stack only after paying users.
- 2026-10-23: Build the MVP first (P1 features); everything else waits in agent/later.md.
- 2026-10-23: Claude Code and Cursor are the first agents; first target codebases are React/Next.js + Supabase.
- 2026-10-23: Explain what you built in plain language at the end of each session; I review every security-sensitive change.
- 2026-10-23: Dogfood: once the MCP server works (FEAT-011), connect it to the sessions building this project.
- 2026-10-23: No Docker. Use a Supabase dev project for development and PGlite for tests.
- 2026-10-23: Use Neon (not Supabase) for our own database: a 'dev' branch for development; tests stay on PGlite. Supabase remains a supported target stack for users' apps.
