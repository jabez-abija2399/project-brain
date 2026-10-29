// FEAT-014: package verification. Pure rules: name and version checks, the risk assessment of a registry document,
// and the dependencies a package.json change adds. The app fetches the registry document and passes it in.
import { maskSecret, maskSecretsIn } from "./mask";
import { oneLineText } from "./text";

const DAY_MS = 86_400_000;
// D-018: versions younger than the release cooldown are flagged (our own install policy uses the same 7 days, D-013).
export const RELEASE_COOLDOWN_DAYS = 7;
// Packages first published less than this many days ago are risky (AC-014-03).
export const NEW_PACKAGE_DAYS = 30;
const MAX_REPO_CHARS = 300;
const MAX_RANGE_CHARS = 100;

// Names AI assistants are known to invent ("slopsquatting"); some have since been registered by attackers, so they
// are flagged even when they exist (AC-014-04). Keep sorted; add names with their source in docs/decisions.md.
export const KNOWN_HALLUCINATED = new Set(["huggingface-cli", "react-codeshift", "unused-imports"]);

// npm naming rules: at most 214 characters, URL-safe characters only, no leading dot or underscore, an optional
// @scope/. Uppercase is allowed because old packages (JSONStream) still use it. Nothing here can change the URL.
const NAME = /^(?:@[a-zA-Z0-9~-][a-zA-Z0-9._~-]*\/)?[a-zA-Z0-9~-][a-zA-Z0-9._~-]*$/;
export function isValidPackageName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 214 &&
    NAME.test(name) &&
    name !== "node_modules" &&
    name !== "favicon.ico"
  );
}

const VERSION = /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z.-]{1,60})?(?:\+[0-9A-Za-z.-]{1,60})?$/;
export const isValidVersion = (v: string) => v.length <= 140 && VERSION.test(v);

// What the assessment needs from a registry document; null = the document is not a usable package document.
export type PackageSummary = {
  created: Date;
  latest: string;
  repository: string | null;
  versions: Map<string, Date>;
  // Versions the maintainer deprecated (often pulled for malware or a serious bug); never suggested.
  deprecated: Set<string>;
};

const asDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || value.length > 40) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// A path segment with at least one letter or digit ("..", "-" or "..." is not a repository).
const SEGMENT = "(?=[\\w.-]*[A-Za-z0-9])[\\w.-]+";
const REPO_URL = /^(?:git\+)?(?:https?|git|ssh|git\+ssh):\/\/[^/]+\/\S+$/i;
const REPO_SHORTHAND = new RegExp(`^(?:(?:github|gitlab|bitbucket):)?${SEGMENT}\\/${SEGMENT}$`);

// A repository link we can show: a URL with a known scheme or a host shorthand (github:user/repo, user/repo).
// Printable ASCII only (no invisible direction marks, no look-alike hosts); credentials in the URL are masked.
function repositoryLink(raw: unknown): string | null {
  const value =
    typeof raw === "object" && raw !== null && Object.hasOwn(raw, "url")
      ? (raw as { url?: unknown }).url
      : raw;
  if (typeof value !== "string" || value.length > MAX_REPO_CHARS) return null;
  const link = value.trim();
  if (!/^[\x21-\x7e]+$/.test(link) || !(REPO_URL.test(link) || REPO_SHORTHAND.test(link)))
    return null;
  // user:password@ is masked by maskSecretsIn; a token used as the user name (https://TOKEN@host) is masked here.
  return maskSecretsIn(link).replace(
    /^([a-z+]+:\/\/)([^/:@]{8,})@/i,
    (_m, scheme: string, user: string) =>
      user.endsWith("***") ? `${scheme}${user}@` : `${scheme}${maskSecret(user)}@`,
  );
}

// The full npm document (GET /<name>). Anything unexpected returns null, which the caller reports as UNREACHABLE:
// a document we cannot read is never called safe (build checklist rule 2).
export function summarizePackument(doc: unknown, name: string): PackageSummary | null {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  if (d.name !== name) return null;
  const time = d.time;
  const tags = d["dist-tags"];
  if (typeof time !== "object" || time === null || typeof tags !== "object" || tags === null) {
    return null;
  }
  const created = asDate((time as Record<string, unknown>).created);
  const latest = (tags as Record<string, unknown>).latest;
  if (!created || typeof latest !== "string" || !isValidVersion(latest)) return null;
  // Real documents keep unpublished versions in `time` but drop them from `versions`: only published ones count.
  const published = d.versions;
  if (typeof published !== "object" || published === null || Array.isArray(published)) return null;
  const versions = new Map<string, Date>();
  const deprecated = new Set<string>();
  for (const [v, t] of Object.entries(time as Record<string, unknown>)) {
    const at = asDate(t);
    if (!at || !isValidVersion(v) || !Object.hasOwn(published, v)) continue;
    versions.set(v, at);
    const manifest = (published as Record<string, unknown>)[v];
    if (
      typeof manifest === "object" &&
      manifest !== null &&
      Object.hasOwn(manifest, "deprecated")
    ) {
      deprecated.add(v);
    }
  }
  if (!versions.has(latest)) return null;
  return { created, latest, repository: repositoryLink(d.repository), versions, deprecated };
}

export type PackageStatus = "EXISTS" | "RISKY" | "NOT_FOUND" | "UNREACHABLE";
export type PackageCheck = {
  name: string;
  status: PackageStatus;
  recommendation:
    | "ok_to_install"
    | "review_before_installing"
    | "do_not_install"
    | "verify_manually";
  latest?: string;
  created?: string;
  last_release?: string;
  repository?: string | null;
  version?: string;
  version_published?: string | null;
  suggested_version?: string | null;
  warnings: string[];
};

// Registry answer for one name: its document summary, "not_found" (404/410 or unpublished) or "unreachable"
// (timeout, network error, oversized or malformed answer).
export type RegistryAnswer = PackageSummary | "not_found" | "unreachable";

const parts = (v: string) => v.split(/[-+]/)[0]?.split(".").map(Number) ?? [];
function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

// The highest stable version that is at least the cooldown old.
function cooledVersion(summary: PackageSummary, now: Date): string | null {
  const cutoff = now.getTime() - RELEASE_COOLDOWN_DAYS * DAY_MS;
  let best: string | null = null;
  for (const [v, at] of summary.versions) {
    if (/[-+]/.test(v) || summary.deprecated.has(v) || at.getTime() > cutoff) continue;
    if (best === null || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

const ageDays = (at: Date, now: Date) => Math.floor((now.getTime() - at.getTime()) / DAY_MS);

/** The verdict for one package (and optionally one version) from the registry's answer. */
export function assessPackage(
  rawName: string,
  answer: RegistryAnswer,
  version: string | null,
  now: Date,
): PackageCheck {
  const hallucinated = KNOWN_HALLUCINATED.has(rawName.toLowerCase());
  // The name is echoed back to the agent, so a secret-shaped one is masked.
  const name = maskSecretsIn(rawName);
  const known = "the name is on the known list of AI-invented package names";
  if (answer === "unreachable") {
    return {
      name,
      status: "UNREACHABLE",
      recommendation: hallucinated ? "do_not_install" : "verify_manually",
      warnings: [
        "the npm registry could not be read (timeout, error or unusable answer); check npmjs.com before installing",
        ...(hallucinated ? [known] : []),
      ],
    };
  }
  if (answer === "not_found") {
    return {
      name,
      status: "NOT_FOUND",
      recommendation: "do_not_install",
      warnings: [
        "no package with this name on npm; it is probably an invented name",
        ...(hallucinated ? [known] : []),
      ],
    };
  }
  const warnings: string[] = [];
  if (hallucinated) warnings.push(`${known}; whoever registered it may not be who you expect`);
  const age = ageDays(answer.created, now);
  if (age < NEW_PACKAGE_DAYS) warnings.push(`the package was first published ${age} day(s) ago`);
  if (!answer.repository) warnings.push("no repository link");
  const checked = version ?? answer.latest;
  const published = answer.versions.get(checked) ?? null;
  let suggested: string | null = null;
  if (!published) {
    warnings.push(`version ${checked} is not published on npm`);
  } else if (answer.deprecated.has(checked)) {
    suggested = cooledVersion(answer, now);
    warnings.push(`version ${checked} is deprecated by its maintainer`);
  } else if (ageDays(published, now) < RELEASE_COOLDOWN_DAYS) {
    suggested = cooledVersion(answer, now);
    const advice = suggested
      ? `install ${suggested} instead`
      : "no older stable version exists; wait";
    const days = ageDays(published, now);
    warnings.push(
      `version ${checked} was published ${days} day(s) ago (release cooldown ${RELEASE_COOLDOWN_DAYS} days): ${advice}`,
    );
  }
  const risky = warnings.length > 0;
  return {
    name,
    status: risky ? "RISKY" : "EXISTS",
    recommendation:
      hallucinated || !published
        ? "do_not_install"
        : risky
          ? "review_before_installing"
          : "ok_to_install",
    latest: answer.latest,
    created: answer.created.toISOString(),
    last_release: answer.versions.get(answer.latest)?.toISOString(),
    repository: answer.repository,
    version: checked,
    version_published: published?.toISOString() ?? null,
    suggested_version: suggested,
    warnings,
  };
}

// A dependency added by a package.json change. target/version: what to look up on npm (an "npm:" alias points
// elsewhere); null target = not from the npm registry (git, file, link, workspace, URL), so it cannot be checked.
export type AddedDependency = {
  name: string;
  range: string;
  target: string | null;
  version: string | null;
};

const SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function depsOf(json: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof json !== "object" || json === null) return out;
  for (const section of SECTIONS) {
    const deps = (json as Record<string, unknown>)[section];
    if (typeof deps !== "object" || deps === null || Array.isArray(deps)) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (!out.has(name)) out.set(name, typeof range === "string" ? range : "");
    }
  }
  return out;
}

function lookupTarget(name: string, range: string): Pick<AddedDependency, "target" | "version"> {
  const alias = range.match(/^npm:((?:@[^/@\s]+\/)?[^@\s]+)(?:@(.*))?$/);
  const target = alias ? (alias[1] ?? "") : name;
  const spec = (alias ? (alias[2] ?? "") : range).trim();
  // A scheme (git+https:, file:, workspace:) or any slash (user/repo, ./dir) is not a registry range.
  if (!alias && /^[a-z+]+:|\//i.test(spec)) return { target: null, version: null };
  const exact = spec.replace(/^=/, "");
  return { target, version: isValidVersion(exact) ? exact : null };
}

/**
 * Dependencies in `after` that are in none of `before`'s dependency sections, or that now come from a different
 * source (AC-014-05). Throws on text that is not
 * a JSON object; `before` is null for a new package.json. Names are returned as written (validated later).
 */
export function addedDependencies(before: string | null, after: string): AddedDependency[] {
  const parse = (text: string) => {
    const json: unknown = JSON.parse(text);
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new SyntaxError("package.json is not a JSON object");
    }
    return json;
  };
  const old = before === null ? new Map<string, string>() : depsOf(parse(before));
  // New names, and existing names whose source changed (an npm: alias to another package, or a move to git/file).
  const repointed = (name: string, range: string) =>
    lookupTarget(name, old.get(name) ?? "").target !== lookupTarget(name, range).target;
  return [...depsOf(parse(after))]
    .filter(([name, range]) => !old.has(name) || repointed(name, range))
    .map(([name, rawRange]) => {
      const range = maskSecretsIn(oneLineText(rawRange)).slice(0, MAX_RANGE_CHARS);
      return { name, range, ...lookupTarget(name, rawRange) };
    });
}
