import { describe, expect, it } from "vitest";
import { discoverBlueprint } from "./discover";
import { parseEars } from "./ears";

const base = {
  symbols: [
    { path: "app/api/orders/route.ts", kind: "route", name: "/api/orders", signature: "route" },
    { path: "app/orders/page.tsx", kind: "route", name: "/orders", signature: "page" },
    { path: "components/OrderList.tsx", kind: "component", name: "OrderList", signature: null },
  ],
  testPaths: ["components/OrderList.test.tsx", "lib/other.test.ts"],
};

describe("Discover (as-built Blueprint)", () => {
  it("BP-3B-01 shows each feature as built: files, routes, components, tests, in build order; next is the first unconfirmed", () => {
    const r = discoverBlueprint({
      ...base,
      features: [
        {
          id: "f1",
          key: "orders",
          name: "Orders",
          purpose: null,
          status: "in_progress",
          buildOrder: 2,
          files: ["app/api/orders/route.ts", "app/orders/page.tsx", "components/OrderList.tsx"],
          criteria: [],
        },
        {
          id: "f2",
          key: "auth",
          name: "Auth",
          purpose: "Sign in",
          status: "done",
          buildOrder: 1,
          files: [],
          criteria: [{ kind: "must_never", status: "active" }],
        },
        {
          id: "t",
          key: "@tests",
          name: "Tests",
          purpose: null,
          status: "todo",
          buildOrder: null,
          files: [],
          criteria: [],
        },
      ],
    });
    expect(r.features.map((f) => f.featureId)).toEqual(["f2", "f1"]);
    const orders = r.features.find((f) => f.featureId === "f1");
    expect(orders).toMatchObject({
      confirmed: false,
      files: 3,
      routes: ["/api/orders", "/orders"],
      components: ["OrderList"],
      tests: 1,
    });
    expect(r.next).toBe("f1");
    expect(r.features.find((f) => f.featureId === "f2")?.confirmed).toBe(true);
  });

  it("BP-3B-02 suggests a must-never and a sign-in criterion in EARS form, never one the feature already covers", () => {
    const r = discoverBlueprint({
      ...base,
      features: [
        {
          id: "f1",
          key: "orders",
          name: "Orders",
          purpose: null,
          status: "todo",
          buildOrder: null,
          files: ["app/api/orders/route.ts"],
          criteria: [],
        },
        {
          id: "f2",
          key: "x",
          name: "Docs",
          purpose: null,
          status: "todo",
          buildOrder: null,
          files: [],
          criteria: [{ kind: "security", status: "active" }],
        },
      ],
    });
    const s = r.features.find((f) => f.featureId === "f1")?.suggestions ?? [];
    expect(s.map((x) => x.kind)).toEqual(["must_never", "security"]);
    for (const x of s) {
      expect(parseEars(x.text)).not.toBeNull();
      expect(x.text.length).toBeLessThanOrEqual(300);
      expect(x.why).toMatch(/\.$/);
    }
    expect(s[1]?.text).toContain("/api/orders");
    expect(r.features.find((f) => f.featureId === "f2")?.suggestions).toEqual([]);
    expect(r.next).toBe("f1");
  });

  it("BP-3B-03 lists at most 10 routes and components per feature and is null-safe with no features", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      path: `components/C${i}.tsx`,
      kind: "component",
      name: `C${i}`,
      signature: null,
    }));
    const r = discoverBlueprint({
      symbols: many,
      testPaths: [],
      features: [
        {
          id: "f",
          key: "ui",
          name: "UI",
          purpose: null,
          status: "todo",
          buildOrder: null,
          files: many.map((m) => m.path),
          criteria: [],
        },
      ],
    });
    expect(r.features[0]?.components).toHaveLength(10);
    expect(r.features[0]?.componentsTotal).toBe(15);
    expect(discoverBlueprint({ symbols: [], testPaths: [], features: [] })).toEqual({
      features: [],
      next: null,
    });
  });
});
