"use client";

// Roadmap Phase 9: "How do you build?" Each answer is a link (it works without JavaScript: the page reads ?build=),
// and is remembered in a cookie the server reads (a display preference only: it unlocks nothing). It can be changed
// at any time. A client component imports nothing from @brain/core (its barrel holds server-only code): the page
// passes the choices in.
export function BuildChoice({
  options,
  current,
  cookieName,
}: {
  options: { style: string; label: string }[];
  current: string | null;
  cookieName: string;
}) {
  return (
    <nav className="row wrap" aria-labelledby="build-how">
      {options.map(({ style, label }) => (
        <a
          key={style}
          href={`/start?build=${encodeURIComponent(style)}`}
          className={`btn ${current === style ? "btn-primary" : "btn-secondary"}`}
          aria-current={current === style ? "true" : undefined}
          onClick={() => {
            const secure = window.location.protocol === "https:" ? "; secure" : "";
            document.cookie = `${cookieName}=${encodeURIComponent(style)}; path=/; max-age=31536000; samesite=lax${secure}`;
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
