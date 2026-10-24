import ts from "typescript";
import { detectComponent, isJsxNode, lineOf } from "./components";
import { type TsconfigPaths, isExternalSpec, loadTsconfigPaths, resolveImport } from "./resolver";
import type { ComponentIndex, ImportIndex, IndexError } from "./types";

export type ParsedFile = {
  components: ComponentIndex[];
  imports: ImportIndex[];
  errors: IndexError[];
  hasJsx: boolean;
};

export function parseSource(
  source: string,
  relPath: string,
  repoRoot: string,
  cfg: TsconfigPaths,
): ParsedFile {
  const scriptKind = kindFor(relPath);
  const sf = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const errors = collectParseErrors(sf, relPath);
  const components: ComponentIndex[] = [];
  const imports: ImportIndex[] = [];
  let hasJsx = false;
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const spec = unquote(node.moduleSpecifier.getText(sf));
      const line = lineOf(sf, node.getStart(sf));
      const { resolved, outside } = resolveImport(spec, relPath, repoRoot, cfg);
      imports.push({
        from: relPath,
        to: spec,
        resolved,
        outside,
        line,
        external: isExternalSpec(spec),
      });
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0] as ts.Node)
    ) {
      const arg = node.arguments[0] as ts.StringLiteralLike;
      const spec = arg.text;
      const line = lineOf(sf, node.getStart(sf));
      const { resolved, outside } = resolveImport(spec, relPath, repoRoot, cfg);
      imports.push({
        from: relPath,
        to: spec,
        resolved,
        outside,
        line,
        external: isExternalSpec(spec),
      });
    }
    const comp = detectComponent(node, sf, relPath);
    if (comp) components.push(comp);
    if (isJsxNode(node)) hasJsx = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { components, imports, errors, hasJsx };
}

function collectParseErrors(sf: ts.SourceFile, relPath: string): IndexError[] {
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.map((d) => {
    const start = typeof d.start === "number" ? d.start : 0;
    const line = sf.getLineAndCharacterOfPosition(start).line + 1;
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    return { path: relPath, line, message };
  });
}

function unquote(text: string): string {
  const t = text.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t.startsWith("`") && t.endsWith("`")) return t.slice(1, -1);
  return t;
}

function kindFor(relPath: string): ts.ScriptKind {
  if (relPath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (relPath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (relPath.endsWith(".ts")) return ts.ScriptKind.TS;
  if (relPath.endsWith(".mjs") || relPath.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.JS;
}

export { loadTsconfigPaths };
