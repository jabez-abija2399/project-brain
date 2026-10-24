import ts from "typescript";
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

function detectComponent(node: ts.Node, sf: ts.SourceFile, relPath: string): ComponentIndex | null {
  if (ts.isFunctionDeclaration(node) && node.name && isPascal(node.name.text)) {
    if (!returnsJsx(node)) return null;
    return makeComponent(node.name.text, node.parameters, sf, relPath, node);
  }
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      if (!isPascal(decl.name.text)) continue;
      const init = decl.initializer;
      if (!init) continue;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        if (!returnsJsx(init)) continue;
        return makeComponent(decl.name.text, init.parameters, sf, relPath, decl);
      }
    }
  }
  return null;
}

function makeComponent(
  name: string,
  params: ts.NodeArray<ts.ParameterDeclaration>,
  sf: ts.SourceFile,
  relPath: string,
  anchor: ts.Node,
): ComponentIndex {
  // Built from the AST, never from source text: names and types only, no initializers or literal values.
  const described = params.map((p) => describeParam(p, sf));
  const first = described[0];
  return {
    name,
    path: relPath,
    line: lineOf(sf, anchor.getStart(sf)),
    props: first ? cap(first) : null,
    signature: cap(`(${described.join(", ")}) => JSX`),
  };
}

const MAX_SIGNATURE = 200;

function cap(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_SIGNATURE ? `${flat.slice(0, MAX_SIGNATURE - 3)}...` : flat;
}

function describeParam(p: ts.ParameterDeclaration, sf: ts.SourceFile): string {
  const rest = p.dotDotDotToken ? "..." : "";
  const optional = p.questionToken || p.initializer ? "?" : "";
  const type = p.type ? `: ${typeWithoutLiterals(p.type, sf)}` : "";
  return `${rest}${bindingNames(p.name)}${optional}${type}`;
}

function bindingNames(name: ts.BindingName): string {
  if (ts.isIdentifier(name)) return name.text;
  const parts = name.elements.map((el) => {
    if (ts.isOmittedExpression(el)) return "";
    const rest = el.dotDotDotToken ? "..." : "";
    if (el.propertyName && ts.isIdentifier(el.propertyName))
      return `${rest}${el.propertyName.text}`;
    if (el.propertyName) return `${rest}[computed]`;
    return `${rest}${bindingNames(el.name)}`;
  });
  return ts.isObjectBindingPattern(name) ? `{ ${parts.join(", ")} }` : `[${parts.join(", ")}]`;
}

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

function typeWithoutLiterals(type: ts.TypeNode, sf: ts.SourceFile): string {
  const keyword = (k: ts.KeywordTypeSyntaxKind) => ts.factory.createKeywordTypeNode(k);
  const strip: ts.TransformerFactory<ts.Node> = (ctx) => (root) => {
    const visit = (n: ts.Node): ts.Node => {
      if (ts.isTemplateLiteralTypeNode(n)) return keyword(ts.SyntaxKind.StringKeyword);
      if (ts.isLiteralTypeNode(n)) {
        const lit = n.literal;
        if (ts.isStringLiteral(lit) || ts.isNoSubstitutionTemplateLiteral(lit)) {
          return keyword(ts.SyntaxKind.StringKeyword);
        }
        if (ts.isNumericLiteral(lit) || ts.isPrefixUnaryExpression(lit)) {
          return keyword(ts.SyntaxKind.NumberKeyword);
        }
        if (ts.isBigIntLiteral(lit)) return keyword(ts.SyntaxKind.BigIntKeyword);
      }
      if (ts.isComputedPropertyName(n)) {
        return ts.factory.createComputedPropertyName(ts.factory.createIdentifier("computed"));
      }
      return ts.visitEachChild(n, visit, ctx);
    };
    return visit(root);
  };
  const result = ts.transform(type, [strip]);
  const text = printer.printNode(ts.EmitHint.Unspecified, result.transformed[0] as ts.Node, sf);
  result.dispose();
  return text;
}

function returnsJsx(fn: ts.FunctionLikeDeclarationBase): boolean {
  if (!fn.body) return false;
  if (ts.isArrowFunction(fn) && fn.body && !ts.isBlock(fn.body)) {
    return isJsxNode(fn.body);
  }
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (ts.isFunctionLike(n) && n !== fn) return;
    if (ts.isReturnStatement(n) && n.expression && isJsxNode(n.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  if (fn.body) walk(fn.body);
  return found;
}

function isJsxNode(n: ts.Node): boolean {
  return (
    ts.isJsxElement(n) ||
    ts.isJsxSelfClosingElement(n) ||
    ts.isJsxFragment(n) ||
    (ts.isParenthesizedExpression(n) && isJsxNode(n.expression))
  );
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

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function unquote(text: string): string {
  const t = text.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t.startsWith("`") && t.endsWith("`")) return t.slice(1, -1);
  return t;
}

function isPascal(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name);
}

function kindFor(relPath: string): ts.ScriptKind {
  if (relPath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (relPath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (relPath.endsWith(".ts")) return ts.ScriptKind.TS;
  if (relPath.endsWith(".mjs") || relPath.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.JS;
}

export { loadTsconfigPaths };
