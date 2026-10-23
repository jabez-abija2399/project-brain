import { describe, expect, it } from "vitest";
import { PACKAGE, VERSION } from "./index";

describe("@brain/core skeleton", () => {
  it("AC-001-01 exposes the package identity", () => {
    expect(PACKAGE).toBe("@brain/core");
    expect(VERSION).toBe("0.0.0");
  });
});
