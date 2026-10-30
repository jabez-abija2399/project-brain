import SignInButton from "@/app/sign-in-button";

// The footer of every public page.
export function SiteFooter() {
  return (
    <footer className="lp-container lp-footer">
      <span className="lp-footer-brand">
        <span className="lp-wordmark">Codeceipt</span>
        <span className="lp-tagline">A receipt for every AI change.</span>
      </span>
      <nav className="lp-footer-links" aria-label="Footer">
        <SignInButton variant="link" />
        <a href="/docs/quickstart">Quickstart</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <span>
          {"©"} {new Date().getFullYear()}
        </span>
      </nav>
    </footer>
  );
}
