// Phase 3a: a Blueprint snapshot is the whole plan as one canonical JSON value: sorted, hashed and diffable. Only
// metadata (names, criteria, paths, patterns): never source code.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { CriterionKind } from "./coverage";
import type { Ears } from "./ears";

export const BLUEPRINT_SNAPSHOT_VERSION = 1;

export const SNAPSHOT_LIMITS = {
  features: 500,
  criteriaPerFeature: 200,
  text: 300,
  pattern: 200,
  listItems: 200,
  testsPerCriterion: 50,
  boundaries: 500,
  directives: 500,
  decisions: 500,
} as const;

export type SnapshotCriterion = {
  id: string;
  text: string;
  ears: Ears | null;
  kind: CriterionKind;
  tests: { fileId: string; testName: string | null }[];
};

export type SnapshotFeature = {
  id: string;
  name: string;
  purpose: string | null;
  buildOrder: number | null;
  dependsOn: string[];
  areas: string[];
  criteria: SnapshotCriterion[];
};

export type BoundaryKind = "protected_path" | "allowed_dependency" | "disallowed_dependency";

export type BlueprintSnapshot = {
  schema: 1;
  features: SnapshotFeature[];
  boundaries: { id: string; kind: BoundaryKind; pattern: string; note: string | null }[];
  directives: { id: string; text: string }[];
  decisions: string[];
};

export type SnapshotInput = Omit<BlueprintSnapshot, "schema">;

// Code-unit order, not locale order: the same input gives the same bytes on every machine.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (list: string[]) => [...list].sort(cmp);

function cleanEars(e: Ears | null): Ears | null {
  if (!e) return null;
  return {
    form: e.form,
    ...(e.trigger !== undefined ? { trigger: e.trigger } : {}),
    ...(e.condition !== undefined ? { condition: e.condition } : {}),
    ...(e.state !== undefined ? { state: e.state } : {}),
    response: e.response,
    negated: e.negated,
  };
}

/** Deterministic snapshot: features by build order (unordered last), then name, then id; every list sorted. */
export function buildSnapshot(input: SnapshotInput): BlueprintSnapshot {
  const features = input.features
    .map((f) => ({
      id: f.id,
      name: f.name,
      purpose: f.purpose,
      buildOrder: f.buildOrder,
      dependsOn: sorted(f.dependsOn),
      areas: sorted(f.areas),
      criteria: [...f.criteria]
        .sort((a, b) => cmp(a.id, b.id))
        .map((c) => ({
          id: c.id,
          text: c.text,
          ears: cleanEars(c.ears),
          kind: c.kind,
          tests: [...c.tests]
            .map((t) => ({ fileId: t.fileId, testName: t.testName }))
            .sort((a, b) => cmp(a.fileId, b.fileId) || cmp(a.testName ?? "", b.testName ?? "")),
        })),
    }))
    .sort(
      (a, b) =>
        (a.buildOrder ?? Number.POSITIVE_INFINITY) - (b.buildOrder ?? Number.POSITIVE_INFINITY) ||
        cmp(a.name, b.name) ||
        cmp(a.id, b.id),
    );
  return {
    schema: BLUEPRINT_SNAPSHOT_VERSION,
    features,
    boundaries: input.boundaries
      .map((b) => ({ id: b.id, kind: b.kind, pattern: b.pattern, note: b.note }))
      .sort((a, b) => cmp(a.id, b.id)),
    directives: input.directives
      .map((d) => ({ id: d.id, text: d.text }))
      .sort((a, b) => cmp(a.id, b.id)),
    decisions: sorted(input.decisions),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => cmp(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** sha256 (hex) of the canonical JSON. */
export function snapshotHash(s: BlueprintSnapshot): string {
  return createHash("sha256").update(canonical(s)).digest("hex");
}

const L = SNAPSHOT_LIMITS;
const text = z.string().max(L.text);
const earsShape = z.strictObject({
  form: z.enum(["event", "unwanted", "never", "state", "ubiquitous"]),
  trigger: text.optional(),
  condition: text.optional(),
  state: text.optional(),
  response: text,
  negated: z.boolean(),
});
const snapshotShape = z.strictObject({
  schema: z.literal(BLUEPRINT_SNAPSHOT_VERSION),
  features: z
    .array(
      z.strictObject({
        id: text,
        name: text,
        purpose: text.nullable(),
        buildOrder: z.number().int().nullable(),
        dependsOn: z.array(text).max(L.listItems),
        areas: z.array(text).max(L.listItems),
        criteria: z
          .array(
            z.strictObject({
              id: text,
              text,
              ears: earsShape.nullable(),
              kind: z.enum(["behaviour", "must_never", "security"]),
              tests: z
                .array(z.strictObject({ fileId: text, testName: text.nullable() }))
                .max(L.testsPerCriterion),
            }),
          )
          .max(L.criteriaPerFeature),
      }),
    )
    .max(L.features),
  boundaries: z
    .array(
      z.strictObject({
        id: text,
        kind: z.enum(["protected_path", "allowed_dependency", "disallowed_dependency"]),
        pattern: z.string().max(L.pattern),
        note: text.nullable(),
      }),
    )
    .max(L.boundaries),
  directives: z.array(z.strictObject({ id: text, text })).max(L.directives),
  decisions: z.array(text).max(L.decisions),
});

/** Strict parse of stored or uploaded JSON: unknown keys and anything over the caps throw. Returns canonical order. */
export function parseSnapshot(json: unknown): BlueprintSnapshot {
  const data = snapshotShape.parse(json);
  return buildSnapshot(data as SnapshotInput);
}

export type SnapshotDiff = {
  addedFeatures: string[];
  removedFeatures: string[];
  changedFeatures: string[];
  addedCriteria: string[];
  removedCriteria: string[];
  changedCriteria: string[];
};

/** What changed from a to b: feature names and criterion ids, each list sorted. */
export function diffSnapshots(a: BlueprintSnapshot, b: BlueprintSnapshot): SnapshotDiff {
  const features = (s: BlueprintSnapshot) => new Map(s.features.map((f) => [f.id, f]));
  const criteria = (s: BlueprintSnapshot) =>
    new Map(s.features.flatMap((f) => f.criteria.map((c) => [c.id, canonical(c)] as const)));
  const fa = features(a);
  const fb = features(b);
  const ca = criteria(a);
  const cb = criteria(b);
  const keys = <V>(m: Map<string, V>, other: Map<string, V>, changed: boolean) =>
    [...m.keys()].filter((k) =>
      changed ? other.has(k) && canonical(m.get(k)) !== canonical(other.get(k)) : !other.has(k),
    );
  const names = (ids: string[], m: Map<string, SnapshotFeature>) =>
    sorted(ids.map((id) => m.get(id)?.name ?? id));
  return {
    addedFeatures: names(keys(fb, fa, false), fb),
    removedFeatures: names(keys(fa, fb, false), fa),
    changedFeatures: names(keys(fa, fb, true), fa),
    addedCriteria: sorted(keys(cb, ca, false)),
    removedCriteria: sorted(keys(ca, cb, false)),
    changedCriteria: sorted(keys(ca, cb, true)),
  };
}
