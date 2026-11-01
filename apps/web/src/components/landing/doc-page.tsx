import { Children, type ReactElement, type ReactNode, cloneElement, isValidElement } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** Plain text of a heading's children (strings and nested elements). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** A heading's anchor: lower case words joined by dashes ("1. Sign in with GitHub" -> "sign-in-with-github"). */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/^\d+\.\s*/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "section"
  );
}

// A reading page (docs, privacy, terms) with the landing page's header and footer: the title, a table of contents
// built from the page's own section headings (after the text in the page, beside it on wide screens), and text kept
// to a comfortable line length.
export function DocPage({
  title,
  updated,
  children,
}: { title: string; updated?: string; children: ReactNode }) {
  const toc: { id: string; label: string }[] = [];
  const body = Children.map(children, (child) => {
    if (isValidElement<{ children?: ReactNode; id?: string }>(child) && child.type === "h2") {
      const label = textOf(child.props.children);
      const id = child.props.id ?? slug(label);
      toc.push({ id, label });
      return cloneElement(child as ReactElement<{ id?: string }>, { id });
    }
    return child;
  });
  return (
    <div className="lp" id="top">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader home="/" />
      <main id="main" className="lp-container doc-layout">
        <header className="doc-head">
          <h1>{title}</h1>
          {updated ? <p className="muted">Last updated {updated}</p> : null}
        </header>
        <article className="lp-doc">{body}</article>
        {toc.length > 1 ? (
          <nav className="doc-toc" aria-label="On this page">
            <p className="doc-toc-title">On this page</p>
            <ol>
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`}>{t.label}</a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
