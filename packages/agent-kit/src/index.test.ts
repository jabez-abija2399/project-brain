import { describe, expect, it } from "vitest";
import { PACKAGE } from "./index";

describe("@brain/agent-kit skeleton", () => {
  it("AC-001-01 exposes the package identity", () => {
    expect(PACKAGE).toBe("@brain/agent-kit");
  });
});
