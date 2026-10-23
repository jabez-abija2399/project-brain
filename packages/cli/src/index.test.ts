import { describe, expect, it } from "vitest";
import { PACKAGE, helpText } from "./index";

describe("@brain/cli skeleton", () => {
  it("AC-001-01 exposes the package identity and help text", () => {
    expect(PACKAGE).toBe("@brain/cli");
    expect(helpText()).toContain("projectbrain");
  });
});
