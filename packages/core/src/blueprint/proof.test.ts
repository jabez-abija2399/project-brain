import { describe, expect, it } from "vitest";
import { proofStatus } from "./proof";

describe("proof status", () => {
  it("BP-3A-13 never claims more certainty than the evidence", () => {
    expect(proofStatus({ tests: [{ present: true, lastResult: "pass" }] })).toBe("proven");
    expect(
      proofStatus({
        tests: [
          { present: true, lastResult: "pass" },
          { present: true, lastResult: "fail" },
        ],
      }),
    ).toBe("contradicted");
    expect(
      proofStatus({ tests: [{ present: true, lastResult: "pass" }], contradicted: true }),
    ).toBe("contradicted");
    expect(proofStatus({ tests: [], itemStatus: "done" })).toBe("done_not_proven");
    expect(proofStatus({ tests: [], itemStatus: "done_untested" })).toBe("done_not_proven");
    expect(proofStatus({ tests: [], itemStatus: "open" })).toBe("not_proven");
    expect(proofStatus({ tests: [] })).toBe("not_proven");
    // A test file that is gone proves nothing, whatever its last recorded result was.
    expect(proofStatus({ tests: [{ present: false, lastResult: "pass" }] })).toBe("not_proven");
    expect(proofStatus({ tests: [{ present: false, lastResult: "fail" }] })).toBe("not_proven");
    // Linked but never run.
    expect(proofStatus({ tests: [{ present: true, lastResult: null }], itemStatus: "done" })).toBe(
      "done_not_proven",
    );
    expect(proofStatus({ tests: [{ present: true }], itemStatus: "open" })).toBe("not_proven");
  });
});
