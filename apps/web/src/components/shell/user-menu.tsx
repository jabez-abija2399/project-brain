"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { SignOutButton } from "./sign-out-button";

// FEAT-028: the account menu in the header, at every width (on phones it also holds Docs, which the header hides).
// Admin appears only after the server says this user is an admin; it is asked once, when the menu is first opened.
export function UserMenu({ name, email }: { name: string; email: string }) {
  const [admin, setAdmin] = useState(false);
  const asked = useRef(false);
  function onToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || asked.current) return;
    asked.current = true;
    fetch("/api/account/admin-link", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { admin: false }))
      .then((b: { admin?: unknown }) => setAdmin(b.admin === true))
      .catch(() => setAdmin(false));
  }
  const label = name.trim() || email.trim() || "Account";
  return (
    <details className="user-menu" onToggle={onToggle}>
      <summary className="btn btn-ghost" title={email} aria-label={`Menu for ${label}`}>
        <span className="user-menu-name">{label}</span>
        <span className="user-menu-short" aria-hidden="true">
          Menu
        </span>
      </summary>
      <nav className="user-menu-panel" aria-label="Account menu">
        <Link href="/account">Account</Link>
        <Link className="user-menu-docs" href="/docs/quickstart">
          Docs
        </Link>
        <Link href="/glossary">Glossary</Link>
        {admin ? <Link href="/admin">Admin</Link> : null}
        <SignOutButton />
      </nav>
    </details>
  );
}
