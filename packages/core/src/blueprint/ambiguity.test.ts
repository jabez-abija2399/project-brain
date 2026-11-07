import { describe, expect, it } from "vitest";
import { ambiguityFlags } from "./ambiguity";
import { parseEars } from "./ears";

const flagsOf = (text: string) => ambiguityFlags(text, parseEars(text));

describe("ambiguity flags", () => {
  it("BP-3A-06 vague words are flagged with a rewrite hint", () => {
    const flags = flagsOf("THE SYSTEM SHALL show a user-friendly error page");
    const vague = flags.find((f) => f.code === "vague_word");
    expect(vague?.span?.toLowerCase()).toBe("user-friendly");
    expect(vague?.rewrite).toBeTruthy();
    expect(vague?.rewrite).not.toContain("user-friendly");
    expect(vague?.message).toMatch(/\.$/);
    expect(
      flagsOf("THE SYSTEM SHALL show the order total").some((f) => f.code === "vague_word"),
    ).toBe(false);
  });

  it("BP-3A-07 weak modals get a SHALL rewrite", () => {
    const flags = flagsOf("The system should email the receipt");
    const weak = flags.find((f) => f.code === "weak_modal");
    expect(weak?.span).toBe("should");
    expect(weak?.rewrite).toBe("The system SHALL email the receipt");
    expect(flagsOf("THE SYSTEM SHALL email the receipt")).toEqual([]);
  });

  it("BP-3A-08 an event with an empty trigger is flagged missing_trigger", () => {
    const flags = flagsOf("WHEN, THE SYSTEM SHALL send a receipt");
    const missing = flags.find((f) => f.code === "missing_trigger");
    expect(missing?.rewrite).toContain("WHEN <");
    expect(missing?.rewrite).toContain("THE SYSTEM SHALL send a receipt");
  });

  it("BP-3A-08 non-EARS text gets a flag with an EARS rewrite", () => {
    const flags = flagsOf("The app must send a receipt.");
    const notEars = flags.find((f) => f.code === "missing_actor");
    expect(notEars?.rewrite).toBe("THE SYSTEM SHALL send a receipt.");
    expect(parseEars(notEars?.rewrite ?? "")).not.toBeNull();
    const bare = flagsOf("Receipts are emailed").find((f) => f.code === "missing_actor");
    expect(parseEars(bare?.rewrite ?? "")).not.toBeNull();
  });

  it("BP-3A-09 performance words without a number and unit are unmeasurable", () => {
    const flags = flagsOf("THE SYSTEM SHALL load the dashboard quickly");
    const perf = flags.find((f) => f.code === "unmeasurable_perf");
    expect(perf?.rewrite).toContain("within <N> ms (p95)");
    expect(
      flagsOf("THE SYSTEM SHALL load the dashboard quickly, within 500 ms").some(
        (f) => f.code === "unmeasurable_perf",
      ),
    ).toBe(false);
  });

  it("BP-3A-10 compound criteria (and/or, two shalls) suggest splitting", () => {
    const andOr = flagsOf("THE SYSTEM SHALL email and/or text the user").find(
      (f) => f.code === "compound",
    );
    expect(andOr?.rewrite).toContain("THE SYSTEM SHALL email the user");
    expect(andOr?.rewrite).toContain("THE SYSTEM SHALL text the user");
    const twoShalls = flagsOf(
      "THE SYSTEM SHALL save the order and the system shall email the receipt",
    ).find((f) => f.code === "compound");
    expect(twoShalls?.rewrite).toContain("THE SYSTEM SHALL save the order");
    expect(twoShalls?.rewrite).toContain("THE SYSTEM SHALL email the receipt");
  });
});
