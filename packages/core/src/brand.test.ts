import { describe, expect, it } from "vitest";
import { PRODUCT_NAME, TAGLINE, brandEnv } from "./brand";

describe("D-019 brand", () => {
  it("is Codeceipt, with its tagline", () => {
    expect([PRODUCT_NAME, TAGLINE]).toEqual(["Codeceipt", "A receipt for every AI change."]);
  });

  it("reads CODECEIPT_ variables first and still accepts the old PROJECTBRAIN_ names", () => {
    expect(brandEnv({ CODECEIPT_TOKEN: "new", PROJECTBRAIN_TOKEN: "old" }, "TOKEN")).toBe("new");
    expect(brandEnv({ PROJECTBRAIN_TOKEN: "old" }, "TOKEN")).toBe("old");
    expect(brandEnv({}, "TOKEN")).toBeUndefined();
  });
});
