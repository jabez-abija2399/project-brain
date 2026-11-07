import { describe, expect, it } from "vitest";
import { planKindToCriterion } from "../plan";

describe("plan kind to criterion kind", () => {
  it("BP-3A-12 planKindToCriterion maps plan item kinds onto criterion kinds", () => {
    expect(planKindToCriterion("attack")).toBe("security");
    expect(planKindToCriterion("permission")).toBe("security");
    expect(planKindToCriterion("negative")).toBe("must_never");
    expect(planKindToCriterion("boundary")).toBe("must_never");
    expect(planKindToCriterion("happy")).toBe("behaviour");
    expect(planKindToCriterion("perf")).toBe("behaviour");
    expect(planKindToCriterion("")).toBe("behaviour");
  });
});
