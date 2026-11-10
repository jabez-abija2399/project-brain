import { describe, expect, it } from "vitest";
import { BUILD_LABELS, BUILD_STYLES, buildGuide, buildStyle } from "./build-guide";

// Roadmap Phase 9: "How do you build?" on the start page.
describe("Phase 9: how do you build", () => {
  it("PH9-12 the query wins over the cookie; anything else is no answer", () => {
    expect(buildStyle("cursor", "claude")).toBe("cursor");
    expect(buildStyle(undefined, "spec")).toBe("spec");
    expect(buildStyle(undefined, undefined)).toBeNull();
    expect(buildStyle("<script>", undefined)).toBeNull();
    expect(buildStyle("__proto__", undefined)).toBeNull();
  });

  it("PH9-13 every way of building has a label and three first steps, starting with connecting the repo", () => {
    for (const s of BUILD_STYLES) {
      expect(BUILD_LABELS[s]).toBeTruthy();
      const steps = buildGuide(s);
      expect(steps).toHaveLength(3);
      expect(steps[0]).toContain("`npx codeceipt`");
    }
    expect(buildGuide("spec").join(" ")).toContain("`codeceipt import`");
    expect(buildGuide("claude").join(" ")).toContain("`/codeceipt-feature`");
  });
});
