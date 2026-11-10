import { describe, expect, it } from "vitest";
import {
  APPROVAL_ACTIONS,
  DEFAULT_POLICY,
  type Policy,
  decide,
  loosens,
  parsePolicy,
} from "./approvals";

// Roadmap Phase 6: approval policies (risk levels, presets, rules, locked actions, pause).
const NOW = new Date("2026-11-10T12:00:00Z");

describe("approval policies (roadmap Phase 6)", () => {
  it("PH6-01 the Balanced default: low is automatic, medium automatic and told, high and locked asked", () => {
    expect(decide(DEFAULT_POLICY, { action: "link_test" }, NOW).choice).toBe("auto");
    expect(decide(DEFAULT_POLICY, { action: "add_dependency" }, NOW).choice).toBe("auto_tell");
    expect(decide(DEFAULT_POLICY, { action: "delete_feature" }, NOW).choice).toBe("ask");
    expect(decide(DEFAULT_POLICY, { action: "turn_off_guard" }, NOW).choice).toBe("ask");
    expect(Object.values(APPROVAL_ACTIONS).filter((r) => r === "locked")).toHaveLength(5);
  });

  it("PH6-02 presets: Careful asks more, Fast asks less, and locked actions are asked in every preset", () => {
    const careful: Policy = { preset: "careful", rules: [] };
    const fast: Policy = { preset: "fast", rules: [] };
    expect(decide(careful, { action: "link_test" }, NOW).choice).toBe("auto_tell");
    expect(decide(careful, { action: "add_dependency" }, NOW).choice).toBe("ask");
    expect(decide(fast, { action: "add_dependency" }, NOW).choice).toBe("auto");
    for (const p of [careful, DEFAULT_POLICY, fast]) {
      expect(decide(p, { action: "remove_protected_path" }, NOW).choice).toBe("ask");
    }
  });

  it("PH6-03 rules: never wins over ask over auto; scoped by action, feature, path and agent", () => {
    const policy: Policy = {
      preset: "balanced",
      rules: [
        { action: "add_dependency", agent: "codex", choice: "auto" },
        { action: "add_dependency", feature: "Checkout", choice: "ask" },
        { action: "*", path: "supabase/**", choice: "never" },
      ],
    };
    expect(decide(policy, { action: "add_dependency", agent: "codex" }, NOW).choice).toBe("auto");
    expect(
      decide(policy, { action: "add_dependency", agent: "codex", feature: "checkout" }, NOW).choice,
    ).toBe("ask");
    expect(
      decide(policy, { action: "link_test", path: "supabase/migrations/1.sql" }, NOW).choice,
    ).toBe("never");
    expect(decide(policy, { action: "link_test", path: "src/a.ts" }, NOW).choice).toBe("auto");
  });

  it("PH6-04 attack: a rule cannot make a locked action automatic; a pause makes nothing automatic", () => {
    const sneaky: Policy = {
      preset: "fast",
      rules: [
        { action: "change_approval_policy", choice: "auto" },
        { action: "*", choice: "auto" },
      ],
    };
    expect(decide(sneaky, { action: "change_approval_policy" }, NOW).choice).toBe("ask");
    expect(decide(sneaky, { action: "turn_off_done_gate" }, NOW).choice).toBe("ask");
    const paused: Policy = { ...DEFAULT_POLICY, pausedUntil: "2026-11-10T13:00:00Z" };
    expect(decide(paused, { action: "link_test" }, NOW).choice).toBe("ask");
    expect(decide(paused, { action: "link_test" }, new Date("2026-11-10T14:00:00Z")).choice).toBe(
      "auto",
    );
  });

  it("PH6-05 loosening is detected (it needs the owner's confirmation); tightening is not", () => {
    const careful: Policy = { preset: "careful", rules: [] };
    expect(loosens(careful, DEFAULT_POLICY, NOW)).toBe(true);
    expect(loosens(DEFAULT_POLICY, careful, NOW)).toBe(false);
    expect(
      loosens(
        DEFAULT_POLICY,
        { preset: "balanced", rules: [{ action: "delete_feature", choice: "auto" }] },
        NOW,
      ),
    ).toBe(true);
    expect(
      loosens(
        DEFAULT_POLICY,
        { preset: "balanced", rules: [{ action: "link_test", choice: "never" }] },
        NOW,
      ),
    ).toBe(false);
    const paused: Policy = { ...DEFAULT_POLICY, pausedUntil: "2026-11-10T13:00:00Z" };
    expect(loosens(paused, DEFAULT_POLICY, NOW)).toBe(true);
  });

  it("PH6-06 attack: untrusted policies are refused whole (unknown actions, choices, keys, too many rules)", () => {
    expect(parsePolicy({ preset: "balanced", rules: [] })).toEqual({
      preset: "balanced",
      rules: [],
      pausedUntil: null,
    });
    expect(parsePolicy({ preset: "yolo", rules: [] })).toBeNull();
    expect(
      parsePolicy({ preset: "fast", rules: [{ action: "rm_rf", choice: "auto" }] }),
    ).toBeNull();
    expect(
      parsePolicy({ preset: "fast", rules: [{ action: "link_test", choice: "always" }] }),
    ).toBeNull();
    expect(
      parsePolicy({ preset: "fast", rules: [{ choice: "auto", __proto__: { x: 1 }, extra: 1 }] }),
    ).toBeNull();
    expect(
      parsePolicy({
        preset: "fast",
        rules: Array.from({ length: 101 }, () => ({ choice: "ask" })),
      }),
    ).toBeNull();
    expect(parsePolicy({ preset: "fast", pausedUntil: "not a date" })).toBeNull();
  });
});
