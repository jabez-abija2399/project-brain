import { maskSecretsIn } from "../mask";
import { ITEM_KINDS, MAX_PLAN_FEATURES, type PlanItem } from "../plan";
import { plainText } from "../text";

// Roadmap Phase 8: import an existing spec into the Blueprint. Deterministic readers (no AI) for the AI Build Kit's
// agent/features.json, Spec Kit, Kiro and OpenSpec specs, AGENTS.md / CLAUDE.md rules and a README's feature list.
// Everything read is untrusted data from the repo: one line, invisible marks removed, secrets masked, capped, and
// tagged with the file and line it came from. The result is a plan draft the owner reviews and approves (high risk,
// `approve_import`); nothing imported is active before that.

export const IMPORT_SOURCES = ["kit", "speckit", "kiro", "openspec", "agents", "readme"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
export type ImportFile = { path: string; text: string };
export type ImportedItem = { text: string; kind: PlanItem["kind"]; line: number };
export type ImportedFeature = {
  name: string;
  path: string;
  line: number;
  dependsOn: string[];
  items: ImportedItem[];
};

export const MAX_IMPORT_FILES = 200;
export const MAX_IMPORT_FILE_CHARS = 256 * 1024;
export const MAX_IMPORT_FEATURES = 500;
const MAX_ITEMS_READ = 50;
const MAX_NAME = 100;
const MAX_TEXT = 240;
const MAX_PATH = 120;

const clean = (value: string, max: number) =>
  maskSecretsIn(plainText(value.replace(/\*\*|__|`/g, ""))).slice(0, max);
const NEGATIVE = /\b(must not|shall not|never|cannot|must refuse|is refused|rejects?|denied)\b/i;
const kindOf = (text: string, given?: unknown): PlanItem["kind"] =>
  typeof given === "string" && (ITEM_KINDS as readonly string[]).includes(given)
    ? (given as PlanItem["kind"])
    : NEGATIVE.test(text)
      ? "negative"
      : "happy";
// Lines longer than this are skipped: no rule, heading or requirement is that long, and it keeps every pattern fast.
const MAX_LINE = 2_000;
/** Line numbers by offset, with one pass over the text (a binary search per lookup). */
function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return (offset) => {
    if (offset < 0) return 1;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}
/** Where each quoted string first appears (one pass), for the kit's ids. */
function firstQuoted(text: string): Map<string, number> {
  const at = new Map<string, number>();
  for (const m of text.matchAll(/"([^"\n]{1,100})"/g)) {
    if (m[1] !== undefined && !at.has(m[1])) at.set(m[1], m.index ?? -1);
  }
  return at;
}
const folder = (path: string, depthFromEnd: number) => {
  const parts = path.split("/");
  return parts[parts.length - 1 - depthFromEnd] ?? path;
};
const words = (slug: string) =>
  slug
    .replace(/^\d+[-_]/, "")
    .replace(/[-_]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

function feature(
  name: string,
  path: string,
  line: number,
  items: ImportedItem[],
  dependsOn: string[] = [],
): ImportedFeature | null {
  const n = clean(name, MAX_NAME);
  if (!n) return null;
  return {
    name: n,
    path: clean(path, MAX_PATH),
    line,
    dependsOn: dependsOn
      .map((d) => clean(d, MAX_NAME))
      .filter(Boolean)
      .slice(0, 20),
    items: items.filter((i) => i.text.length > 0).slice(0, MAX_ITEMS_READ),
  };
}

/** The kit's agent/features.json: features (title before its colon), acceptance checks and their kinds. */
function readKit(file: ImportFile): ImportedFeature[] {
  let doc: unknown;
  try {
    doc = JSON.parse(file.text);
  } catch {
    return [];
  }
  const list = (doc as { features?: unknown })?.features;
  if (!Array.isArray(list)) return [];
  const titles = new Map<string, string>();
  const short = (title: string) => {
    const head = title.split(":")[0]?.trim() ?? "";
    return head.length >= 3 ? head : title;
  };
  for (const f of list) {
    if (f && typeof f.id === "string" && typeof f.title === "string")
      titles.set(f.id, short(f.title));
  }
  const quoted = firstQuoted(file.text);
  const lineOf = lineIndex(file.text);
  const out: ImportedFeature[] = [];
  for (const f of list.slice(0, MAX_IMPORT_FEATURES)) {
    if (!f || typeof f.title !== "string") continue;
    const at = typeof f.id === "string" ? (quoted.get(f.id) ?? -1) : -1;
    const acceptance: unknown[] = Array.isArray(f.acceptance)
      ? f.acceptance.slice(0, MAX_ITEMS_READ)
      : [];
    const items = acceptance.flatMap((a): ImportedItem[] => {
      const c = a as { id?: unknown; check?: unknown; kind?: unknown };
      if (typeof c.check !== "string") return [];
      const text = clean(c.check, MAX_TEXT);
      const idAt = typeof c.id === "string" ? (quoted.get(c.id) ?? -1) : -1;
      return [{ text, kind: kindOf(text, c.kind), line: lineOf(idAt) }];
    });
    const deps: unknown[] = Array.isArray(f.depends_on) ? f.depends_on : [];
    const made = feature(
      short(f.title),
      file.path,
      lineOf(at),
      items,
      deps.flatMap((d) =>
        typeof d === "string" && titles.has(d) ? [titles.get(d) as string] : [],
      ),
    );
    if (made) out.push(made);
  }
  return out;
}

/** Markdown lines matching `pick`, each as an item with its line number. */
function lines(text: string, pick: (line: string) => string | null): ImportedItem[] {
  const out: ImportedItem[] = [];
  for (const [i, raw] of text.split("\n").entries()) {
    if (out.length >= MAX_ITEMS_READ) break;
    if (raw.length > MAX_LINE) continue;
    const got = pick(raw);
    if (got === null) continue;
    const t = clean(got, MAX_TEXT);
    if (t) out.push({ text: t, kind: kindOf(t), line: i + 1 });
  }
  return out;
}

const heading = (text: string, re: RegExp) => {
  for (const [i, l] of text.split("\n").entries()) {
    if (l.length > MAX_LINE) continue;
    const m = re.exec(l);
    if (m?.[1]) return { name: m[1], line: i + 1 };
  }
  return null;
};

/** Spec Kit specs/<feature>/spec.md: functional requirements (FR-n) and acceptance scenarios (Given/When/Then). */
function readSpecKit(file: ImportFile): ImportedFeature[] {
  const h = heading(file.text, /^#\s+Feature Specification:\s*(.+)$/);
  const items = lines(file.text, (l) => {
    const fr = /^\s*-\s+\*\*FR-\d+\*\*:?\s*(.+)$/.exec(l);
    if (fr?.[1]) return fr[1];
    const sc = /^\s*\d+\.\s+(\*\*Given\*\*.+)$/.exec(l);
    return sc?.[1] ?? null;
  });
  const made = feature(h?.name ?? words(folder(file.path, 1)), file.path, h?.line ?? 1, items);
  return made ? [made] : [];
}

/** Kiro .kiro/specs/<feature>/requirements.md: the numbered EARS acceptance criteria (WHEN/IF ... SHALL ...). */
function readKiro(file: ImportFile): ImportedFeature[] {
  const items = lines(file.text, (l) => {
    const m = /^\s*\d+\.\s+((?:WHEN|IF|WHILE|WHERE|THE)\b.*\bSHALL\b.*)$/i.exec(l);
    return m?.[1] ?? null;
  });
  const made = feature(words(folder(file.path, 1)), file.path, 1, items);
  return made ? [made] : [];
}

/** OpenSpec openspec/specs/<capability>/spec.md: each requirement's first SHALL/MUST sentence. */
function readOpenSpec(file: ImportFile): ImportedFeature[] {
  const all = file.text.split("\n");
  const items: ImportedItem[] = [];
  for (const [i, l] of all.entries()) {
    if (items.length >= MAX_ITEMS_READ) break;
    if (l.length > MAX_LINE) continue;
    const req = /^###\s+Requirement:\s*(.+)$/.exec(l);
    if (!req?.[1]) continue;
    // The requirement's own sentence (the next non-empty line with SHALL or MUST), else its title.
    let text = req[1];
    let line = i + 1;
    for (let j = i + 1; j < Math.min(all.length, i + 6); j++) {
      const next = all[j] ?? "";
      if (/^#/.test(next)) break;
      if (/\b(SHALL|MUST)\b/.test(next)) {
        text = next;
        line = j + 1;
        break;
      }
    }
    const t = clean(text, MAX_TEXT);
    if (t) items.push({ text: t, kind: kindOf(t), line });
  }
  const made = feature(words(folder(file.path, 1)), file.path, 1, items);
  return made ? [made] : [];
}

/** AGENTS.md / CLAUDE.md: the bullet rules under a heading that names rules, as one "Project rules" feature. */
function readAgents(file: ImportFile): ImportedFeature[] {
  let inRules = false;
  const items = lines(file.text, (l) => {
    if (/^#{1,4}\s/.test(l)) {
      inRules = /rule|must|never|always|do not|don't/i.test(l);
      return null;
    }
    // A line such as "Project rules (max 10):" starts a rule list too.
    // Security review: a plain check, not a regex that backtracks over a long line.
    if (l.trimEnd().endsWith(":") && /\brules?\b/i.test(l)) {
      inRules = true;
      return null;
    }
    if (!inRules) return null;
    const m = /^\s*[-*]\s+(.{8,})$/.exec(l);
    return m?.[1] ?? null;
  });
  const made = feature("Project rules", file.path, 1, items);
  return made && made.items.length > 0 ? [made] : [];
}

/** README: each bullet under a "Features" heading becomes a feature, the bullet itself its first criterion. */
function readReadme(file: ImportFile): ImportedFeature[] {
  const out: ImportedFeature[] = [];
  let inFeatures = false;
  for (const [i, l] of file.text.split("\n").entries()) {
    if (out.length >= MAX_PLAN_FEATURES * 2) break;
    if (l.length > MAX_LINE) continue;
    if (/^#{1,4}\s/.test(l)) {
      inFeatures = /^#{1,4}\s+(key\s+)?features\b/i.test(l);
      continue;
    }
    if (!inFeatures) continue;
    const m = /^\s*[-*]\s+(.{3,})$/.exec(l);
    if (!m?.[1]) continue;
    const text = clean(m[1], MAX_TEXT);
    const name = (text.split(/[:.\u2013\u2014]| - /)[0] ?? text).trim().slice(0, 60);
    const made = feature(name, file.path, i + 1, [{ text, kind: kindOf(text), line: i + 1 }]);
    if (made) out.push(made);
  }
  return out;
}

const READERS: Record<ImportSource, (f: ImportFile) => ImportedFeature[]> = {
  kit: readKit,
  speckit: readSpecKit,
  kiro: readKiro,
  openspec: readOpenSpec,
  agents: readAgents,
  readme: readReadme,
};

/** Which files each source reads (repo-relative paths; the CLI lists them with git). */
export function importPathMatches(source: ImportSource, path: string): boolean {
  switch (source) {
    case "kit":
      return path === "agent/features.json";
    case "speckit":
      return /^specs\/[^/]+\/spec\.md$/.test(path);
    case "kiro":
      return /^\.kiro\/specs\/[^/]+\/requirements\.md$/.test(path);
    case "openspec":
      return /^openspec\/specs\/[^/]+\/spec\.md$/.test(path);
    case "agents":
      return path === "AGENTS.md" || path === "CLAUDE.md";
    case "readme":
      return /^readme\.md$/i.test(path);
  }
}

/** The features a source describes, from its files (capped: 200 files, 256 KB each, 500 features). */
export function importFeatures(source: ImportSource, files: ImportFile[]): ImportedFeature[] {
  const out: ImportedFeature[] = [];
  for (const f of files.slice(0, MAX_IMPORT_FILES)) {
    if (out.length >= MAX_IMPORT_FEATURES) break;
    out.push(...READERS[source]({ path: f.path, text: f.text.slice(0, MAX_IMPORT_FILE_CHARS) }));
  }
  return out.slice(0, MAX_IMPORT_FEATURES);
}

export { type ImportDraft, importDraft } from "./draft";
