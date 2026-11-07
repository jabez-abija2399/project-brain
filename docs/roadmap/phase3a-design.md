# Phase 3a design (Blueprint model) — saved from planning agent 2026-11-07
Key decisions:
- 0054_blueprint adds ONLY new tables (never columns on hot tables): blueprints(project_id PK, current_version, updated_by, updated_at),
  blueprint_versions(id, project_id, version, snapshot jsonb ≤256KB, snapshot_hash, reason edit|accept_proposal|restore|plan_approve,
  restored_from, created_by, created_at; UNIQUE(project_id,version); BEFORE UPDATE trigger raises), feature_dependencies(project_id,
  feature_id, depends_on_id; PK; CHECK no self; composite FKs), feature_areas(project_id, feature_id, pattern ≤200),
  criteria(id, project_id, feature_id, text ≤300 masked, ears jsonb, kind behaviour|must_never|security, status proposal|active|retired,
  created_by agent|owner, proposed_change jsonb, proposed_at, checklist_item_id NULL (composite FK SET NULL; needs unique index
  checklist_items(project_id,id)), position, created_at, confirmed_at), criterion_tests(project_id, criterion_id, file_id, test_name NULL),
  boundaries(id, project_id, kind protected_path|allowed_dependency|disallowed_dependency, pattern ≤200, note, status proposal|active|dismissed,
  created_by, created_at, confirmed_at).
- Reuse: features.description=purpose, build_order, status, feature_files, directives (rules), decisions.
- Versions: owner writes in one tx under features:${pid} lock: baseVersion check (409 blueprint_changed) → apply → buildSnapshot → insert N+1.
  Restore(N) rewrites spec fields only; criteria not in snapshot -> retired (never deleted); never touches status/requests/receipts.
- Feature flag: FEATURE_MIGRATIONS {blueprint:"0054_blueprint"} excluded from requiredPending; blueprintEnabled(db) via cached missingMigrations;
  flag off -> web 404 blueprint_not_ready, MCP error, context pack w/o CRITERIA.
- Core packages/core/src/blueprint/: ears.ts (parseEars/formatEars/plainSentence, forms event|unwanted|never|state|ubiquitous),
  ambiguity.ts (vague_word, weak_modal, missing_trigger, missing_actor, unmeasurable_perf, compound + rewrites), contradictions.ts
  (subjectKey; move nearDuplicateKey to core/text.ts), coverage.ts (mustNeverCoverage warn-only; checkBlueprint), proof.ts
  (proofStatus: failing test or contradiction -> contradicted; passing/linked test -> proven; item done/done_untested -> done_not_proven; else not_proven),
  snapshot.ts (buildSnapshot deterministic, snapshotHash, parseSnapshot strict zod, diffSnapshots), rewrite-llm.ts (optional 1 call, masked, null on fail).
  plan.ts planKindToCriterion: attack/permission->security, negative/boundary->must_never, else behaviour.
- Repos: blueprintRepo(get,currentVersion,listVersions,getVersion,commit,restore), criteriaRepo, boundariesRepo.
- apps/web/src/server/blueprint.ts: requireProjectAccess + blueprintEnabled; blueprintView, editBlueprint(ops zod), accept/dismissProposal,
  restoreVersion, versionHistory, suggestRewrites; approvePlan writes deps+criteria+version 1.
- MCP: get_context_pack CRITERIA + BOUNDARIES sections (HEADING_WORDS); where_did_we_stop {blueprint:true}; new tool propose_blueprint
  (≤400 chars; kinds behaviour|must_never|security|protected_path|allowed_dependency|disallowed_dependency; returns EARS+flags; ≤20 open proposals).
- Tests BP-3A-01..30 (see list in agent report; attack tests in blueprint.security.test.ts).
- 3b: Discover, interview, safety check, proof from receipts, 0054 -> required. 3c: web UI.
