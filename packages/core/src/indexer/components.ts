import ts from "typescript";
import type { ComponentIndex } from "./types";

export function detectComponent(
  node: ts.Node,
  sf: ts.SourceFile,
  relPath: string,
): ComponentIndex | null {
  if (ts.isFunctionDeclaration(node)) {
    const name = node.name ? node.name.text : isDefaultExport(node) ? "default" : null;
    if (!name || !isPascalOrDefault(name) || !returnsJsx(node)) return null;
    return makeComponent(name, node.parameters, sf, relPath, node);
  }
  if (ts.isClassDeclaration(node)) {
    const name = node.name ? node.name.text : isDefaultExport(node) ? "default" : null;
    if (!name || !isPascalOrDefault(name)) return null;
    const propsType = reactComponentProps(node);
    if (propsType === null) return null;
    const props = propsType ? `props: ${typeWithoutLiterals(propsType, sf)}` : null;
    return {
      name,
      path: relPath,
      line: lineOf(sf, node.getStart(sf)),
      props: props ? cap(props) : null,
      signature: cap(`(${props ?? ""}) => JSX`),
    };
  }
  if (ts.isExportAssignment(node) && !node.isExportEquals) {
    const fn = unwrapComponentFn(node.expression);
    if (!fn) return null;
    const name = fn.name && ts.isIdentifier(fn.name) ? fn.name.text : "default";
    return makeComponent(name, fn.parameters, sf, relPath, node);
  }
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      if (!isPascal(decl.name.text)) continue;
      const fn = decl.initializer ? unwrapComponentFn(decl.initializer) : null;
      if (!fn) continue;
      return makeComponent(decl.name.text, fn.parameters, sf, relPath, decl);
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

const COMPONENT_WRAPPERS = new Set(["memo", "forwardRef"]);
const COMPONENT_BASES = new Set(["Component", "PureComponent"]);

// A JSX-returning function, possibly wrapped in memo()/forwardRef() (also React.memo, nested).
function unwrapComponentFn(expr: ts.Expression): ts.ArrowFunction | ts.FunctionExpression | null {
  let current = skipParens(expr);
  while (ts.isCallExpression(current) && COMPONENT_WRAPPERS.has(calleeName(current.expression))) {
    const arg = current.arguments[0];
    if (!arg) return null;
    current = skipParens(arg);
  }
  if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && returnsJsx(current)) {
    return current;
  }
  return null;
}

// For `class X extends (React.)Component<P>` with a render() method: P (undefined if untyped); otherwise null.
function reactComponentProps(node: ts.ClassDeclaration): ts.TypeNode | undefined | null {
  const base = node.heritageClauses
    ?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
    ?.types.find((t) => COMPONENT_BASES.has(calleeName(t.expression)));
  if (!base) return null;
  const hasRender = node.members.some(
    (m) => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === "render",
  );
  if (!hasRender) return null;
  return base.typeArguments?.[0];
}

function calleeName(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return "";
}

function skipParens(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) {
    e = e.expression;
  }
  return e;
}

function isDefaultExport(node: ts.FunctionDeclaration | ts.ClassDeclaration): boolean {
  const mods = ts.getModifiers(node) ?? [];
  return (
    mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
    mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
  );
}

// What a return can evaluate to: JSX directly, or through ?:, &&, ||, ?? and parentheses.
function yieldsJsx(expr: ts.Expression): boolean {
  const e = skipParens(expr);
  if (isJsxNode(e)) return true;
  if (ts.isConditionalExpression(e)) return yieldsJsx(e.whenTrue) || yieldsJsx(e.whenFalse);
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return yieldsJsx(e.left) || yieldsJsx(e.right);
    }
  }
  return false;
}

function returnsJsx(fn: ts.FunctionLikeDeclarationBase): boolean {
  if (!fn.body) return false;
  if (ts.isArrowFunction(fn) && fn.body && !ts.isBlock(fn.body)) {
    return yieldsJsx(fn.body);
  }
  let found = false;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (ts.isFunctionLike(n) && n !== fn) return;
    if (ts.isReturnStatement(n) && n.expression && yieldsJsx(n.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  if (fn.body) walk(fn.body);
  return found;
}

export function isJsxNode(n: ts.Node): boolean {
  return (
    ts.isJsxElement(n) ||
    ts.isJsxSelfClosingElement(n) ||
    ts.isJsxFragment(n) ||
    (ts.isParenthesizedExpression(n) && isJsxNode(n.expression))
  );
}

export function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function isPascal(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name);
}

function isPascalOrDefault(name: string): boolean {
  return name === "default" || isPascal(name);
}
