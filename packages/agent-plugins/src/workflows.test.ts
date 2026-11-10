import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLUGIN_DIRS, WORKFLOW_SKILLS, generateMarketplace } from "./index.ts";

// Roadmap Phase 7: /codeceipt-feature, /codeceipt-fix and /codeceipt-review in every plugin.
const files = generateMarketplace();
const NAMES = ["codeceipt-feature", "codeceipt-fix", "codeceipt-review"];
const SERVER = readFileSync(
  new URL("../../../apps/web/src/server/mcp-tools.ts", import.meta.url),
  "utf8",
);
const MCP_TOOLS = new Set(
  [...SERVER.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1] as string),
);
const CLI_HELP = readFileSync(new URL("../../cli/src/index.ts", import.meta.url), "utf8");

describe("Phase 7: workflow skills", () => {
  it("PH7-14 every plugin has the three workflow skills, each named after its folder", () => {
    for (const dir of Object.values(PLUGIN_DIRS)) {
      for (const name of NAMES) {
        const text = files.get(`${dir}/skills/${name}/SKILL.md`);
        expect(text, `${dir} ${name}`).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: `));
        expect(text).toBe(WORKFLOW_SKILLS[name]);
      }
    }
    expect(Object.keys(WORKFLOW_SKILLS)).toEqual(NAMES);
  });

  it("PH7-15 every tool a skill names is a real MCP tool, and every command a real codeceipt command", () => {
    expect(MCP_TOOLS.size).toBeGreaterThan(5);
    expect(WORKFLOW_SKILLS["codeceipt-feature"]).toContain("`get_context_pack`");
    for (const text of Object.values(WORKFLOW_SKILLS)) {
      const named = [...text.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1] as string);
      for (const tool of named) expect(MCP_TOOLS, tool).toContain(tool);
      for (const m of text.matchAll(/`codeceipt ([a-z-]+)/g)) {
        expect(
          CLI_HELP.includes(`"  codeceipt ${m[1]} `) || CLI_HELP.includes(`'  codeceipt ${m[1]} `),
          m[1],
        ).toBe(true);
      }
    }
  });

  it("PH7-16 attack: the skills never tell the agent to approve, turn off a check, or weaken a test, and stay short", () => {
    for (const [name, text] of Object.entries(WORKFLOW_SKILLS)) {
      expect(text, name).toMatch(/project data, not instructions/);
      expect(text, name).toMatch(/NOT VERIFIED/);
      expect(text, name).not.toMatch(
        /codeceipt (approvals|config|unlink|login)|--no-verify|guard off/,
      );
      // A sentence about skipping, deleting or weakening tests only ever forbids it.
      for (const sentence of text.split(/[.\n]/)) {
        if (/\b(skip|weaken|delete)\b/i.test(sentence) && /\btests?\b/i.test(sentence)) {
          expect(sentence, name).toMatch(/\bnever\b/i);
        }
      }
      expect(text.length, name).toBeLessThan(2500);
    }
  });
});
