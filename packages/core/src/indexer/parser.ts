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
    const spec = moduleSpecifierOf(node);
    if (spec !== null) {
      const { resolved, outside } = resolveImport(spec, relPath, repoRoot, cfg);
      const line = lineOf(sf, node.getStart(sf));
      imports.push({
        from: relPath,
        to: spec,
        resolved,
        outside,
        line,
        external: isExternalSpec(spec, cfg),
      });
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    }
    const comp = detectComponent(node, sf, relPath);
    if (comp) components.push(comp);
    if (isJsxNode(node)) hasJsx = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { components, imports, errors, hasJsx };
}

// The literal module specifier of import/export ... from, require("x") or import("x"); null otherwise.
function moduleSpecifierOf(node: ts.Node): string | null {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const spec = node.moduleSpecifier;
    return spec && ts.isStringLiteralLike(spec) ? spec.text : null;
  }
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return null;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const arg = node.arguments[0] as ts.Expression;
  return (isRequire || isDynamicImport) && ts.isStringLiteralLike(arg) ? arg.text : null;
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

function kindFor(relPath: string): ts.ScriptKind {
  if (relPath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (relPath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (relPath.endsWith(".ts")) return ts.ScriptKind.TS;
  if (relPath.endsWith(".mjs") || relPath.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.JS;
}

export { loadTsconfigPaths };
