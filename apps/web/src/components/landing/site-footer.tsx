import { NPM_URL } from "./content";

// The footer of every page, public and signed in (the app shell passes signedIn so it shows no Sign in).
export function SiteFooter({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-row">
        <span className="lp-footer-brand">
          <span className="lp-wordmark">Codeceipt</span>
          <span className="lp-tagline">A receipt for every AI change.</span>
        </span>
        <nav className="lp-footer-links" aria-label="Footer">
          <a href="/docs/quickstart">Docs</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href={NPM_URL} rel="noopener noreferrer">
            npm package
          </a>
          {signedIn ? null : <a href="/sign-in">Sign in</a>}
          <span className="lp-footer-year">
            {"©"} {new Date().getFullYear()} Codeceipt
          </span>
        </nav>
      </div>
    </footer>
  );
}
