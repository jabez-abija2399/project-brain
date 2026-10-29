import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { IndexResult } from "./indexer";
import { maskSecretsIn } from "./mask";

// The server's cap on import paths per file (apps/web code-index-limits.ts MAX_IMPORTS_PER_FILE).
const MAX_IMPORTS = 500;

export type UploadSymbol = { kind: "component" | "route"; name: string; signature: string };
export type UploadFile = {
  path: string;
  hash: string;
  symbols: UploadSymbol[];
  imports: string[];
};

// Metadata only: path, hash, the repo paths it imports, and per symbol its kind, name and AST signature (secrets
// masked). No source text.
export function toUpload(index: IndexResult): UploadFile[] {
  const byPath = new Map<string, UploadFile>(
    index.files.map((f) => [
      f.path,
      {
        path: f.path,
        hash: f.hash,
        symbols: [],
        imports: [
          ...new Set(
            f.imports.flatMap((i) => (i.resolved && i.resolved !== f.path ? [i.resolved] : [])),
          ),
        ]
          .sort()
          .slice(0, MAX_IMPORTS),
      },
    ]),
  );
  // KI-036: what an import resolves to can change while the file does not (a new tsconfig.json, an added file), so the
  // diff hash includes the resolved imports. They are hashed relative to the file's folder, so a folder moved with the
  // files it imports keeps its hashes (the server matches a renamed hand-placed file by hash, KI-027).
  for (const f of byPath.values()) {
    if (f.imports.length === 0) continue;
    const dir = posix.dirname(f.path);
    const rel = f.imports.map((i) => posix.relative(dir, i)).sort();
    f.hash = createHash("sha256")
      .update(`${f.hash}\nimports:${rel.join("\n")}`)
      .digest("hex");
  }
  for (const c of index.components) {
    byPath.get(c.path)?.symbols.push({
      kind: "component",
      name: c.name,
      signature: maskSecretsIn(c.signature),
    });
  }
  const declared = new Map<string, string[]>();
  for (const r of index.routes) {
    byPath.get(r.file)?.symbols.push({ kind: "route", name: r.path, signature: r.method });
    if (r.declaredIn) declared.set(r.file, [...(declared.get(r.file) ?? []), r.path]);
  }
  // A React Router route lives in App.tsx but is stored on the page's file: the page's diff hash includes its URLs,
  // so a route changed only in App.tsx re-uploads the page (and a removed route clears it).
  for (const [path, urls] of declared) {
    const f = byPath.get(path);
    if (f)
      f.hash = createHash("sha256")
        .update(`${f.hash}\nroutes:${urls.sort().join("\n")}`)
        .digest("hex");
  }
  return [...byPath.values()];
}
