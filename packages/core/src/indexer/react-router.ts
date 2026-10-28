import ts from "typescript";
import { lineOf } from "./components";

/** A React Router route declared in code: its URL and the file of the component it renders. */
export type DeclaredRoute = { path: string; file: string; line: number };

const ROUTER_CALLS = new Set([
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
  "useRoutes",
]);
// Caps for one file: a generated route table cannot make the index unbounded.
const MAX_ROUTES = 500;
const MAX_DEPTH = 20;

// URL of a child route under its parent's URL (React Router: a path starting with / is absolute).
function joinPath(parent: string, child: string | null): string {
  if (child === null || child === "") return parent || "/";
  if (child.startsWith("/")) return child;
  if (!parent) return child === "*" ? "*" : `/${child}`;
  return `${parent.replace(/\/$/, "")}/${child}`;
}

function stringOf(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isJsxExpression(node)) return stringOf(node.expression);
  return null;
}

// The specifier of the first import("x") inside node (lazy(() => import("./Page")), lazy: () => import(...)).
function dynamicImportIn(node: ts.Node): string | null {
  let found: string | null = null;
  const visit = (n: ts.Node) => {
    if (found !== null) return;
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments[0] &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      found = n.arguments[0].text;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * Routes declared with <Route path element|Component> (nested <Route>s join their parent's path) or with
 * createBrowserRouter/useRoutes route objects (path, index, element, Component, lazy, children). The rendered
 * component is matched to the file it is imported from (static import or lazy(() => import())); routes whose
 * component is defined in this file or cannot be resolved are skipped. Only paths and file names are returned.
 */
export function detectRouterRoutes(
  sf: ts.SourceFile,
  relPath: string,
  resolve: (spec: string) => string | null,
): DeclaredRoute[] {
  const fileOf = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteralLike(stmt.moduleSpecifier)) {
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const file = resolve(stmt.moduleSpecifier.text);
      if (!file) continue;
      if (clause.name) fileOf.set(clause.name.text, file);
      const named = clause.namedBindings;
      if (named && ts.isNamedImports(named))
        for (const el of named.elements) fileOf.set(el.name.text, file);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (!ts.isCallExpression(decl.initializer)) continue;
        const spec = dynamicImportIn(decl.initializer);
        const file = spec === null ? null : resolve(spec);
        if (file) fileOf.set(decl.name.text, file);
      }
    }
  }

  const routes: DeclaredRoute[] = [];
  const add = (path: string, file: string | null, node: ts.Node) => {
    if (!file || file === relPath || routes.length >= MAX_ROUTES) return;
    routes.push({ path, file, line: lineOf(sf, node.getStart(sf)) });
  };
  // The page a JSX element renders: the last imported component in it (<Guard><Page /></Guard> is Page).
  const pageIn = (node: ts.Node | undefined): string | null => {
    let file: string | null = null;
    const visit = (n: ts.Node) => {
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
        const tag = n.tagName;
        if (ts.isIdentifier(tag) && fileOf.has(tag.text)) file = fileOf.get(tag.text) ?? null;
      }
      ts.forEachChild(n, visit);
    };
    if (node) visit(node);
    return file;
  };
  const identFile = (node: ts.Node | undefined): string | null => {
    const expr = node && ts.isJsxExpression(node) ? node.expression : node;
    return expr && ts.isIdentifier(expr) ? (fileOf.get(expr.text) ?? null) : null;
  };

  const visitJsx = (node: ts.Node, parent: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening && ts.isIdentifier(opening.tagName) && opening.tagName.text === "Route") {
      const attrs = new Map<string, ts.JsxAttribute>();
      for (const a of opening.attributes.properties)
        if (ts.isJsxAttribute(a) && ts.isIdentifier(a.name)) attrs.set(a.name.text, a);
      const path = joinPath(parent, stringOf(attrs.get("path")?.initializer));
      add(
        path,
        pageIn(attrs.get("element")?.initializer) ?? identFile(attrs.get("Component")?.initializer),
        opening,
      );
      if (ts.isJsxElement(node)) for (const c of node.children) visitJsx(c, path, depth + 1);
      return;
    }
    ts.forEachChild(node, (c) => visitJsx(c, parent, depth + 1));
  };

  const visitObjects = (node: ts.Node | undefined, parent: string, depth: number) => {
    if (!node || depth > MAX_DEPTH || !ts.isArrayLiteralExpression(node)) return;
    for (const el of node.elements) {
      if (!ts.isObjectLiteralExpression(el)) continue;
      const props = new Map<string, ts.Expression>();
      for (const p of el.properties)
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)))
          props.set(p.name.text, p.initializer);
      const path = joinPath(parent, stringOf(props.get("path")));
      const lazy = props.get("lazy");
      const lazySpec = lazy ? dynamicImportIn(lazy) : null;
      add(
        path,
        pageIn(props.get("element")) ??
          identFile(props.get("Component")) ??
          (lazySpec === null ? null : resolve(lazySpec)),
        el,
      );
      visitObjects(props.get("children"), path, depth + 1);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      visitJsx(node, "", 0);
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      if (ROUTER_CALLS.has(name)) visitObjects(node.arguments[0], "", 0);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return routes;
}
